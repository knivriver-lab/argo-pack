/**
 * hello-band — a webview and nothing else.
 *
 * It loads one static page out of the extension's own bundle. That is the entire feature. It
 * exists so that the frame, the content-security policy, the nonce and the theme-token bridge
 * are all exercised by something small enough to read in a minute, and so the next plank that
 * needs a webview has a working example to copy rather than a blank file.
 *
 * `localResourceRoots` is pinned to this extension's `media` directory, so the page cannot reach
 * anything in the open workspace even by accident.
 */

import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';

const VIEW_TYPE = 'helloBand.page';

let panel: vscode.WebviewPanel | undefined;

function nonce(): string {
  return randomBytes(16).toString('base64');
}

function render(webview: vscode.Webview, extensionUri: vscode.Uri, html: string): string {
  const mediaUri = vscode.Uri.joinPath(extensionUri, 'media');
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'hello.css'));
  const n = nonce();
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource}`,
    `script-src 'nonce-${n}'`,
  ].join('; ');

  return html
    .replace(/\{\{csp\}\}/g, csp)
    .replace(/\{\{nonce\}\}/g, n)
    .replace(/\{\{style\}\}/g, styleUri.toString());
}

async function show(context: vscode.ExtensionContext): Promise<void> {
  const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

  if (panel !== undefined) {
    panel.reveal(column);
    return;
  }

  panel = vscode.window.createWebviewPanel(VIEW_TYPE, 'Hello Band', column, {
    enableScripts: true,
    retainContextWhenHidden: false,
    localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
  });

  panel.onDidDispose(
    () => {
      panel = undefined;
    },
    undefined,
    context.subscriptions,
  );

  const pageUri = vscode.Uri.joinPath(context.extensionUri, 'media', 'hello.html');
  const bytes = await vscode.workspace.fs.readFile(pageUri);
  panel.webview.html = render(panel.webview, context.extensionUri, new TextDecoder().decode(bytes));
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('helloBand.show', () => {
      void show(context);
    }),
  );
}

export function deactivate(): void {
  panel?.dispose();
  panel = undefined;
}
