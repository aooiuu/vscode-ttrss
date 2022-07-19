import * as vscode from 'vscode';
import { app } from '../App';
import { COMMANDS } from '../constants';

export class ArticleListProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(article: Article): vscode.TreeItem {
    let tooltip = article.title;
    tooltip += `\n---`;
    tooltip += `\nid: ${article.id}`;
    tooltip += `\nfeed: ${article.feed_title}`;
    if (article.author) {
      tooltip += `\nauthor: ${article.author}`;
    }
    const labels = article.labels.map((e: any[]) => e[1]).join(',');
    if (labels) {
      tooltip += `\nlabels: ${labels}`;
    }
    tooltip += `\nlink: [${article.link}](${article.link})`;

    return {
      label: article.title,
      id: article.id,
      tooltip: new vscode.MarkdownString(tooltip.replace(/\n/g, '\n\n')),
      iconPath: article.unread ? new vscode.ThemeIcon('circle-filled') : undefined,
      contextValue: article.marked ? 'unstar' : 'star',
      description: new Date(article.updated * 1000).toLocaleString(),
      collapsibleState: vscode.TreeItemCollapsibleState.None,
      command: {
        command: COMMANDS.getArticle,
        title: 'getArticle',
        arguments: [article]
      }
    };
  }

  getChildren(article?: Article): vscode.TreeItem[] {
    if (!article) {
      return app.getArticles();
    } else {
      return [];
    }
  }
}

export class Article {
  constructor(
    public readonly id: string,
    public readonly title: string,
    public readonly feed_id: string,
    public readonly feed_title: string,
    public readonly link: string,
    public readonly labels: any[],
    public readonly author: string,
    public readonly updated: number,
    public unread: boolean,
    public marked: boolean
  ) {}
}
