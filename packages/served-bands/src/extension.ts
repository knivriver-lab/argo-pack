/**
 * served-bands — the editor half.
 *
 * One extension, four webview views in the Mew'd container. Every one of them is the same
 * provider with a different band, because the difference between "Needs you" and "Berths" is a
 * route and a title, and inventing four classes to say that would be inventing three of them.
 *
 * The shape that matters:
 *
 *     webview  ──(ready | refresh | signIn)──▶  extension host  ──▶  authentication provider
 *        ▲                                            │
 *        └────────(loading | data | signIn | error)───┘ ──▶  <baseUrl>/dashboard/…
 *
 * The bearer is obtained here, put on the request here, and never leaves here. The webview is
 * handed rows. It has no URL, no header, no credential, and no way to make a request — its
 * `localResourceRoots` is pinned to this extension's own `media` directory, and its content
 * security policy is `default-src 'none'` with `connect-src 'none'` said out loud.
 *
 * A 401 becomes a **sign-in affordance in the view**, not a redirect: the operator presses a
 * button, the host calls the authentication provider, and the browser that opens is opened by
 * the editor rather than by a page.
 */

import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { BANDS, type Band } from './bands.js';
import { fetchBand, type FetchLike } from './client.js';
import { hostMessageFor, isViewMessage, type HostMessage } from './protocol.js';
import { renderBandPage } from './page.js';

/** The provider `fabric-auth` registers, and the role a band is a view of. */
const PROVIDER_ID = 'mewd';
const CONSTRUCTOR_ROLE = 'role:constructor';

const CONFIG_SECTION = 'mewd.fabric';
const BASE_URL_KEY = 'baseUrl';

const UNCONFIGURED =
  'Set mewd.fabric.baseUrl to the fabric this editor should read. There is no default — this pack is public and carries no host of anyone’s.';

const NOT_SIGNED_IN = 'This editor is not signed in to the Mew’d fabric.';

const fetchImpl: FetchLike = (input, init) => globalThis.fetch(input, init) as ReturnType<FetchLike>;

function nonce(): string {
  return randomBytes(16).toString('base64');
}

function baseUrl(): string | null {
  const value = vscode.workspace.getConfiguration(CONFIG_SECTION).get<string>(BASE_URL_KEY);
  const trimmed = typeof value === 'string' ? value.trim().replace(/\/+$/, '') : '';
  return trimmed === '' ? null : trimmed;
}

/**
 * The bearer, or nothing.
 *
 * `createIfNone` is false: a band redraws itself whenever the editor feels like it, and a view
 * that could start an authorization flow on its own would turn a window layout change into a
 * browser tab. The operator asks, through the button in the view.
 */
async function currentBearer(createIfNone: boolean): Promise<string | null> {
  try {
    const session = await vscode.authentication.getSession(PROVIDER_ID, [CONSTRUCTOR_ROLE], { createIfNone });
    return session?.accessToken ?? null;
  } catch {
    // No provider registered (fabric-auth not installed), or the operator dismissed the flow.
    return null;
  }
}

class BandViewProvider implements vscode.WebviewViewProvider {
  readonly #band: Band;
  readonly #extensionUri: vscode.Uri;
  #view: vscode.WebviewView | undefined;

  constructor(band: Band, extensionUri: vscode.Uri) {
    this.#band = band;
    this.#extensionUri = extensionUri;
  }

  async resolveWebviewView(view: vscode.WebviewView): Promise<void> {
    this.#view = view;
    const mediaUri = vscode.Uri.joinPath(this.#extensionUri, 'media');

    view.webview.options = {
      enableScripts: true,
      // The page cannot reach the open workspace, even by accident.
      localResourceRoots: [mediaUri],
    };

    const template = new TextDecoder().decode(
      await vscode.workspace.fs.readFile(vscode.Uri.joinPath(mediaUri, 'band.html')),
    );

    view.webview.html = renderBandPage(template, {
      band: this.#band,
      cspSource: view.webview.cspSource,
      styleUri: view.webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'band.css')).toString(),
      scriptUri: view.webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'band.js')).toString(),
      nonce: nonce(),
    });

    view.webview.onDidReceiveMessage((raw: unknown) => {
      if (!isViewMessage(raw)) return;
      switch (raw.type) {
        case 'ready':
        case 'refresh':
          void this.load();
          return;
        case 'signIn':
          void this.signIn();
          return;
      }
    });

    view.onDidChangeVisibility(() => {
      if (view.visible) void this.load();
    });
  }

  #post(message: HostMessage): void {
    void this.#view?.webview.postMessage(message);
  }

  /** Fetch the band's route with the bearer, and post whatever came back. */
  async load(): Promise<void> {
    const origin = baseUrl();
    if (origin === null) {
      this.#post({ type: 'unconfigured', band: this.#band.id, reason: UNCONFIGURED });
      return;
    }

    const bearer = await currentBearer(false);
    if (bearer === null) {
      this.#post({ type: 'signIn', band: this.#band.id, reason: NOT_SIGNED_IN });
      return;
    }

    this.#post({ type: 'loading', band: this.#band.id });
    this.#post(hostMessageFor(this.#band.id, await fetchBand(origin, this.#band, bearer, fetchImpl)));
  }

  /** The affordance the view offers on a 401. The host starts the flow; the view never does. */
  async signIn(): Promise<void> {
    const bearer = await currentBearer(true);
    if (bearer === null) {
      this.#post({ type: 'signIn', band: this.#band.id, reason: NOT_SIGNED_IN });
      return;
    }
    await this.load();
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const providers = BANDS.map((band) => {
    const provider = new BandViewProvider(band, context.extensionUri);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(band.viewId, provider));
    return provider;
  });

  const reloadAll = (): void => {
    for (const provider of providers) void provider.load();
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('mewdBands.refresh', reloadAll),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(`${CONFIG_SECTION}.${BASE_URL_KEY}`)) reloadAll();
    }),
    vscode.authentication.onDidChangeSessions((event) => {
      if (event.provider.id === PROVIDER_ID) reloadAll();
    }),
  );
}

export function deactivate(): void {
  // Every band holds a view the editor owns and a cache it can lose. There is nothing to unwind.
}
