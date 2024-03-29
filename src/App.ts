import * as vscode from 'vscode';
import { FeedListProvider, Feed } from './explorer/feeds';
import { ArticleListProvider, Article } from './explorer/articles';
import ttrss from './ttrss';
import { config } from './config';
import { COMMANDS } from './constants';

class App {
  private feedListProvider: FeedListProvider = new FeedListProvider();
  private articleListProvider: ArticleListProvider = new ArticleListProvider();
  private feeds: Feed[] = [];
  private articles: Article[] = [];
  private refreshTimer?: NodeJS.Timer;
  private webviewPanel?: vscode.WebviewPanel;
  private context?: vscode.ExtensionContext;
  private refreshArticleListFn: Function = async () => {};
  private page: number = 1;

  activate(context: vscode.ExtensionContext) {
    this.context = context;
    const registerCommand = vscode.commands.registerCommand;
    const registerTreeDataProvider = vscode.window.registerTreeDataProvider;
    [
      registerCommand(COMMANDS.signin, this.signin, this),
      registerCommand(COMMANDS.signout, this.signout, this),
      registerCommand(COMMANDS.getFeedList, this.getFeedList, this),
      registerCommand(COMMANDS.getArticleList, this.getArticleList, this),
      registerCommand(COMMANDS.getArticle, this.getArticle, this),
      registerCommand(COMMANDS.markAsRead, this.markAsRead, this),
      registerCommand(COMMANDS.markAsReadAndNextPage, this.markAsReadAndNextPage, this),
      registerCommand(COMMANDS.star, this.star, this),
      registerCommand(COMMANDS.unstar, this.unstar, this),
      registerCommand(COMMANDS.viewInBrowser, this.viewInBrowser, this),
      registerCommand(COMMANDS.subscribeToFeed, this.subscribeToFeed, this),
      registerCommand(COMMANDS.unsubscribeFeed, this.unsubscribeFeed, this),
      registerCommand(COMMANDS.searchArticles, this.searchArticles, this),
      registerCommand(COMMANDS.lastPage, this.lastPage, this),
      registerCommand(COMMANDS.nextPage, this.nextPage, this)
    ].forEach((command) => context.subscriptions.push(command));
    registerTreeDataProvider('z-rss-feeds', this.feedListProvider);
    registerTreeDataProvider('z-rss-articles', this.articleListProvider);

    this.initRefreshTimer();
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (e.affectsConfiguration('z-rss.refreshInterval')) {
        this.initRefreshTimer();
      }
    });
    vscode.commands.executeCommand(COMMANDS.getFeedList);
  }

  initRefreshTimer() {
    this.refreshTimer && clearInterval(this.refreshTimer);
    const refreshInterval: number = config.app.get('refreshInterval', 0) * 1000;
    if (refreshInterval) {
      this.refreshTimer = setInterval(() => {
        vscode.commands.executeCommand(COMMANDS.getFeedList);
      }, refreshInterval);
    }
  }

  async signin() {
    const url = await vscode.window.showInputBox({
      prompt: 'server url'
    });
    if (!url) {
      return;
    }
    const user = await vscode.window.showInputBox({
      prompt: 'user'
    });
    if (!user) {
      return;
    }
    const password = await vscode.window.showInputBox({
      prompt: 'password',
      password: true
    });
    if (!password) {
      return;
    }
    config.app
      .update('url', url, true)
      .then(() => config.app.update('user', user, true))
      .then(() => config.app.update('password', password, true))
      .then(() => vscode.commands.executeCommand(COMMANDS.getFeedList));
  }

  async signout() {
    config.app.update('url', '', true);
    config.app.update('user', '', true);
    config.app.update('password', '', true);
    ttrss.sid = undefined;
    await ttrss.fetch({
      op: 'logout'
    });
  }

  getFeeds() {
    return this.feeds;
  }

  mergeFeedInfo(feeds: Feed[], feedsMap: Map<any, any>) {
    if (Array.isArray(feeds)) {
      feeds.forEach((feed) => {
        const data = feedsMap.get(feed.bare_id);
        if (data) {
          feed.unread = data.unread;
        }
        if (feed.items?.length) {
          this.mergeFeedInfo(feed.items, feedsMap);
        }
      });
    }
  }

  // 获取订阅列表
  async getFeedList() {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: 'loading...',
        cancellable: false
      },
      async () => {
        const res = await ttrss.fetch({
          op: 'getFeedTree'
        });
        const feedsRes = await ttrss.fetch({
          op: 'getFeeds',
          cat_id: -3
        });
        const items = res?.content?.categories?.items as Feed[];
        if (Array.isArray(items) && Array.isArray(feedsRes?.content)) {
          const feedMap = new Map(feedsRes.content.map((feed: any): [number, any] => [feed.id, feed]));
          this.mergeFeedInfo(items, feedMap);

          items.forEach((feed) => {
            if (Array.isArray(feed.items)) {
              const unread = feed.items.reduce((p, v) => {
                if (v.unread > 0) {
                  p += v.unread;
                }
                return p;
              }, 0);
              feed.unread = unread;
            }
          });

          this.feeds = items;
        } else {
          this.feeds = [];
        }
        this.feedListProvider.refresh();
      }
    );
  }

  getArticles() {
    return this.articles;
  }

  // 获取文章列表
  async getArticleList(feed?: Feed) {
    if (!feed) {
      await this.refreshArticleListFn();
    } else {
      await this.getHeadlines({
        feed_id: feed.bare_id,
        is_cat: String(feed.id).startsWith('CAT:')
      });
    }
  }

  // 获取分页参数
  getPageParams() {
    return {
      limit: 20,
      skip: 20 * (this.page - 1)
    };
  }

  // 上一页
  lastPage() {
    this.page = Math.max(1, this.page - 1);
    this.refreshArticleListFn(this.getPageParams());
  }

  // 下一页
  nextPage() {
    this.page++;
    this.refreshArticleListFn(this.getPageParams());
  }

  // 获取文章列表
  async getHeadlines(params: any) {
    this.page = 1;
    this.refreshArticleListFn = async (newParams: any) => {
      await this.getHeadlines({
        ...params,
        ...newParams
      });
    };
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: 'loading...',
        cancellable: false
      },
      async () => {
        const viewMode: string = config.app.get('getHeadlinesViewMode', '');
        const res = await ttrss.fetch({
          op: 'getHeadlines',
          ...params,
          view_mode: params.viewMode || viewMode
        });
        if (Array.isArray(res?.content)) {
          this.articles = res?.content;
        } else {
          this.articles = [];
        }
        this.articleListProvider.refresh();
      }
    );
  }

  // 获取文章详情
  async getArticle(article: Article) {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: 'loading...',
        cancellable: false
      },
      async () => {
        const res = await ttrss.fetch({
          op: 'getArticle',
          article_id: article.id
        });
        let content = res?.content?.[0]?.content;
        if (!content) {
          vscode.window.showWarningMessage('empty content');
        } else {
          if (config.app.get('hideImage', false)) {
            content = content.replace(/<img .*?>/gim, '');
          }
          const injectedHtml = config.app.get('injectedHtml', '');
          content && this.openWebviewPanel(article, `${injectedHtml}<style>body{font-size:1em}</style>${content}`);
        }
        article.unread = false;
        await this.markAsReadByArticleIds(article.id, true);
        await this.getFeedList();
      }
    );
  }

  // 置为已读根据ID
  async markAsReadByArticleIds(ids: string | string[], isRead: boolean) {
    await ttrss.fetch({
      op: 'updateArticle',
      article_ids: typeof ids === 'object' ? ids.join(',') : ids,
      mode: Number(!isRead),
      field: 2
    });
    this.articleListProvider.refresh();
  }

  // 置为已读根据文章
  async markAsReadByFeed(feed: Feed) {
    await ttrss.fetch({
      op: 'catchupFeed',
      feed_id: feed.bare_id,
      is_cat: String(feed.id).startsWith('CAT:')
    });
  }

  // 置为已读
  async markAsRead(feed?: Feed) {
    if (feed) {
      await this.markAsReadByFeed(feed);
      await this.getArticleList(feed);
    } else {
      await this.markAsReadByArticleIds(
        this.articles.map((article) => {
          article.unread = false;
          return article.id;
        }),
        true
      );
    }
    this.articleListProvider.refresh();
    this.getFeedList();
  }

  // 置为已读并刷新
  async markAsReadAndNextPage() {
    this.markAsRead();
    this.getArticleList();
  }

  // 收藏
  async star(article: Article) {
    this.starArticle(article, true);
  }

  // 取消收藏
  async unstar(article: Article) {
    this.starArticle(article, false);
  }

  // 收藏请求
  async starArticle(article: Article, isStar: boolean) {
    await ttrss.fetch({
      op: 'updateArticle',
      article_ids: article.id,
      mode: Number(isStar),
      field: 0
    });
    this.getArticleList();
    this.getFeedList();
  }

  // 打开阅读面板
  async openWebviewPanel(article: Article, content: string) {
    const title: string = config.app.get('readerViewTitle', '').replace(new RegExp('\\${name}', 'g'), article.title || '');

    if (!this.webviewPanel) {
      this.webviewPanel = vscode.window.createWebviewPanel('rss', title, vscode.ViewColumn.One, {
        retainContextWhenHidden: true,
        enableScripts: true
      });
      this.webviewPanel.onDidDispose(
        () => {
          this.webviewPanel = undefined;
        },
        this,
        this.context!.subscriptions
      );
    } else {
      this.webviewPanel.title = title;
    }
    this.webviewPanel.webview.html = content;
    this.webviewPanel.reveal();
  }

  // 通过外部浏览器阅读
  viewInBrowser(article: Article) {
    if (article.link) {
      vscode.env.openExternal(vscode.Uri.parse(article.link));
    }
  }

  subscribeToFeed() {}

  unsubscribeFeed() {}

  // 搜索
  async searchArticles() {
    const searchPrefix = config.app.get('searchPrefix', '');
    const keyword = await vscode.window.showInputBox({
      prompt: 'Search query consists of several keywords. Several special keywords are available: https://tt-rss.org/wiki/SearchSyntax',
      value: searchPrefix
    });
    if (!keyword) {
      return;
    }
    this.getHeadlines({
      feed_id: -4,
      search: keyword,
      search_mode: 'all_feeds'
    });
  }
}

export const app = new App();
