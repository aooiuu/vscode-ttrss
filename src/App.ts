import * as vscode from "vscode";
import { FeedListProvider, Feed } from "./explorer/feeds";
import { ArticleListProvider, Article } from "./explorer/articles";
import ttrss from "./ttrss";
import { config } from "./config";
import { COMMANDS } from "./constants";

class App {
  private feedListProvider: FeedListProvider;
  private articleListProvider: ArticleListProvider;
  private feeds: Feed[] = [];
  private articles: Article[] = [];
  private currentFeed?: Feed;
  private refreshTimer?: NodeJS.Timer;

  constructor() {
    this.feedListProvider = new FeedListProvider();
    this.articleListProvider = new ArticleListProvider();
  }

  activate(context: vscode.ExtensionContext) {
    const registerCommand = vscode.commands.registerCommand;
    const registerTreeDataProvider = vscode.window.registerTreeDataProvider;
    [
      registerCommand(COMMANDS.signin, this.signin, this),
      registerCommand(COMMANDS.signout, this.signout, this),
      registerCommand(COMMANDS.getFeedList, this.getFeedList, this),
      registerCommand(COMMANDS.getArticleList, this.getArticleList, this),
      registerCommand(COMMANDS.getArticle, this.getArticle, this),
      registerCommand(COMMANDS.markAsRead, this.markAsRead, this),
      registerCommand(COMMANDS.star, this.star, this),
      registerCommand(COMMANDS.unstar, this.unstar, this),
      registerCommand(COMMANDS.viewInBrowser, this.viewInBrowser, this),
      registerCommand(COMMANDS.subscribeToFeed, this.subscribeToFeed, this),
      registerCommand(COMMANDS.unsubscribeFeed, this.unsubscribeFeed, this),
    ].forEach((command) => context.subscriptions.push(command));
    registerTreeDataProvider("z-rss-feeds", this.feedListProvider);
    registerTreeDataProvider("z-rss-articles", this.articleListProvider);

    this.initRefreshTimer();
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (e.affectsConfiguration("z-rss.refreshInterval")) {
        this.initRefreshTimer();
      }
    });
    vscode.commands.executeCommand(COMMANDS.getFeedList);
  }

  initRefreshTimer() {
    this.refreshTimer && clearInterval(this.refreshTimer);
    const refreshInterval: number = config.app.get("refreshInterval", 0) * 1000;
    if (refreshInterval) {
      this.refreshTimer = setInterval(() => {
        vscode.commands.executeCommand(COMMANDS.getFeedList);
      }, refreshInterval);
    }
  }

  async signin() {
    const url = await vscode.window.showInputBox({
      prompt: "server url",
    });
    if (!url) {
      return;
    }
    const user = await vscode.window.showInputBox({
      prompt: "user",
    });
    if (!user) {
      return;
    }
    const password = await vscode.window.showInputBox({
      prompt: "password",
      password: true,
    });
    if (!password) {
      return;
    }
    config.app.update("url", url, true)
      .then(() => config.app.update("user", user, true))
      .then(() => config.app.update("password", password, true))
      .then(()=> vscode.commands.executeCommand(COMMANDS.getFeedList));
  }

  async signout() {
    config.app.update("url", "", true);
    config.app.update("user", "", true);
    config.app.update("password", "", true);
    ttrss.sid = undefined;
    await ttrss.fetch({
      op: "logout",
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

  async getFeedList() {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: "loading...",
        cancellable: false,
      },
      async () => {
        const res = await ttrss.fetch({
          op: "getFeedTree",
        });
        const feedsRes = await ttrss.fetch({
          op: "getFeeds",
          cat_id: -3,
        });
        const items = res?.content?.categories?.items as Feed[];
        if (Array.isArray(items) && Array.isArray(feedsRes?.content)) {
          const feedMap = new Map(
            feedsRes.content.map((feed: any): [number, any] => [feed.id, feed])
          );
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
        this.feedListProvider?.refresh();
      }
    );
  }

  getArticles() {
    return this.articles;
  }

  async getArticleList(pFeed?: Feed) {
    const feed = pFeed || this.currentFeed;
    if (!feed) {
      return;
    }
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: "loading...",
        cancellable: false,
      },
      async () => {
        const res = await ttrss.fetch({
          op: "getHeadlines",
          feed_id: feed.bare_id,
          is_cat: feed.id.startsWith("CAT:"),
          // view_mode (string = all_articles, unread, adaptive, marked, updated)
          // view_mode: "adaptive",
        });
        if (Array.isArray(res?.content)) {
          this.articles = res?.content;
        } else {
          this.articles = [];
        }
        this.articleListProvider?.refresh();
        this.currentFeed = feed;
      }
    );
  }

  async getArticle(article: Article) {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: "loading...",
        cancellable: false,
      },
      async () => {
        const res = await ttrss.fetch({
          op: "getArticle",
          article_id: article.id,
        });
        let content = res?.content?.[0]?.content;
        if (!content) {
          return;
        }

        if (config.app.get("hideImage", false)) {
          content = content.replace(/<img .*?>/gim, "");
        }

        content &&
          this.openWebviewPanel(
            article,
            `<style>body{font-size:1em}</style>${content}`
          );
        article.unread = false;
        this.articleListProvider?.refresh();

        await ttrss.fetch({
          op: "updateArticle",
          article_ids: article.id,
          mode: Number(article.unread),
          // field (integer) - field to operate on (0 - starred, 1 - published, 2 - unread, 3 - article note since api level 1)
          field: 2,
        });

        await this.getFeedList();
      }
    );
  }

  async markAsRead(pFeed?: Feed) {
    const feed = pFeed || this.currentFeed;
    if (!feed) {
      return;
    }
    await ttrss.fetch({
      op: "catchupFeed",
      feed_id: feed.bare_id,
      is_cat: feed.id.startsWith("CAT:"),
    });
    this.getArticleList(feed);
    this.getFeedList();
  }

  async star(article: Article) {
    this.starArticle(article, true);
  }

  async unstar(article: Article) {
    this.starArticle(article, false);
  }

  async starArticle(article: Article, isStar: boolean) {
    await ttrss.fetch({
      op: "updateArticle",
      article_ids: article.id,
      mode: Number(isStar),
      field: 0,
    });
    this.getArticleList();
    this.getFeedList();
  }

  async openWebviewPanel(article: Article, content: string) {
    const panel = vscode.window.createWebviewPanel(
      "rss",
      article.title,
      vscode.ViewColumn.One,
      { retainContextWhenHidden: true, enableScripts: true }
    );
    panel.webview.html = content;
  }

  viewInBrowser(article: Article) {
    if (article.link) {
      vscode.env.openExternal(vscode.Uri.parse(article.link));
    }
  }

  subscribeToFeed() {}

  unsubscribeFeed() {}
}

export const app = new App();
