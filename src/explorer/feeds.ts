import * as vscode from "vscode";
import { app } from "../App";
import { COMMANDS } from "../constants";

export class FeedListProvider
  implements vscode.TreeDataProvider<vscode.TreeItem>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<
    vscode.TreeItem | undefined
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(feed: Feed): vscode.TreeItem {
    let label: string = "";
    if (feed.unread > 0) {
      label = feed.name + ` (${feed.unread})`;
    } else {
      label = feed.name;
    }

    return {
      label,
      id: feed.id,
      tooltip: feed.name,
      // iconPath:
      //   feed.unread > 0 ? new vscode.ThemeIcon("circle-filled") : undefined,
      collapsibleState: feed.items?.length
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
      command: feed.items?.length
        ? undefined
        : {
            command: COMMANDS.getArticleList,
            title: "getArticleList",
            arguments: [feed],
          },
    };
  }

  getChildren(element?: Feed): vscode.TreeItem[] {
    if (!element) {
      return app.getFeeds();
    } else {
      return element.items || [];
    }
  }
}

type FeedType = "category" | "feed";

export class Feed {
  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly bare_id: string,
    public readonly type: FeedType,
    public unread: number,
    public readonly items?: Feed[]
  ) {}
}
