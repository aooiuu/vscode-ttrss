import { workspace } from 'vscode';

export class config {
  static get app() {
    return workspace.getConfiguration('z-rss');
  }
}
