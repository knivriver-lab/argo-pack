/**
 * fabric-auth — the editor half.
 *
 * One `AuthenticationProvider`, registered under the id `mewd`, so that every other plank in the
 * pack asks for a bearer the way any VS Code extension asks for one:
 *
 *     vscode.authentication.getSession('mewd', ['role:constructor'], { createIfNone: false })
 *
 * and nothing else in the pack ever sees an authorization code, a verifier or a refresh token.
 * The flow itself — challenge, exchange, refresh, revoke — is in `oauth.ts` and `session.ts`,
 * neither of which imports an editor API, so all of it is tested without one.
 *
 * The redirect comes back through the editor's own URI handler
 * (`<scheme>://mewd.fabric-auth/callback`). There is no loopback listener, no tunnel and no
 * vendor identity provider in the middle: the authorization request goes to the operator's
 * browser, and the answer comes back to the editor that asked.
 */

import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import { BASE_URL_SETTING, CLIENT_ID_SETTING, CONFIG_SECTION, readFabricConfig, type FabricConfig } from './config.js';
import {
  authorizationUrl,
  CONSTRUCTOR_ROLE,
  discoverEndpoints,
  exchangeCode,
  OAuthError,
  type Endpoints,
  type FetchLike,
} from './oauth.js';
import {
  acceptGrant,
  clearSession,
  describeSession,
  RoleNotGrantedError,
  SessionStore,
  type SecretStore,
  type SessionsConfig,
  type StoredSession,
} from './session.js';
import { createPkce, createState } from './pkce.js';

/** The provider id other planks ask for, and the label the editor shows beside it. */
export const PROVIDER_ID = 'mewd';
export const PROVIDER_LABEL = "Mew'd fabric";

const EXTENSION_ID = 'mewd.fabric-auth';
const CALLBACK_PATH = '/callback';

/** How long an authorization is allowed to stay open before it is abandoned. */
const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;

const output = vscode.window.createOutputChannel('Mew’d fabric');

/**
 * Everything this plank writes down. `describeSession` is the only renderer of a session, and it
 * carries no token; keeping the channel behind this one function is what stops that from
 * drifting.
 */
function log(line: string): void {
  output.appendLine(`${new Date().toISOString()}  ${line}`);
}

const fetchImpl: FetchLike = (input, init) => globalThis.fetch(input, init) as ReturnType<FetchLike>;

function toAuthenticationSession(session: StoredSession): vscode.AuthenticationSession {
  return {
    id: session.id,
    accessToken: session.accessToken,
    account: { id: session.account.id, label: session.account.label },
    scopes: [...session.scopes],
  };
}

class ConfigurationError extends Error {}

function currentConfig(): FabricConfig {
  const settings = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const result = readFabricConfig(settings.get('baseUrl'), settings.get('clientId'));
  if (!result.ok) throw new ConfigurationError(result.problem);
  return result.config;
}

/**
 * The pending authorization, keyed by its `state`.
 *
 * A callback whose state is not the one this editor generated is dropped. That is the whole of
 * the CSRF defence and it is the reason `state` is generated with the same randomness as the
 * verifier rather than being a counter.
 */
interface Pending {
  readonly resolve: (code: string) => void;
  readonly reject: (err: Error) => void;
}

const pending = new Map<string, Pending>();

class FabricUriHandler implements vscode.UriHandler {
  handleUri(uri: vscode.Uri): void {
    if (uri.path !== CALLBACK_PATH) return;
    const params = new URLSearchParams(uri.query);
    const state = params.get('state') ?? '';
    const waiting = pending.get(state);
    if (waiting === undefined) {
      log('callback arrived with a state this editor did not issue — dropped');
      return;
    }
    pending.delete(state);

    const error = params.get('error');
    if (error !== null) {
      waiting.reject(new OAuthError(error, params.get('error_description') ?? `the fabric refused: ${error}`));
      return;
    }
    const code = params.get('code');
    if (code === null) {
      waiting.reject(new OAuthError('invalid_response', 'the callback carried neither a code nor an error'));
      return;
    }
    waiting.resolve(code);
  }
}

/** The one provider. */
class MewdAuthenticationProvider implements vscode.AuthenticationProvider, vscode.Disposable {
  readonly #changed = new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
  readonly #secrets: SecretStore;
  readonly #redirectUri: string;

  readonly onDidChangeSessions = this.#changed.event;

  constructor(secrets: SecretStore, redirectUri: string) {
    this.#secrets = secrets;
    this.#redirectUri = redirectUri;
  }

  dispose(): void {
    this.#changed.dispose();
  }

  async #endpoints(config: FabricConfig): Promise<Endpoints> {
    return discoverEndpoints(config.baseUrl, fetchImpl);
  }

  async #store(config: FabricConfig): Promise<SessionStore> {
    const endpoints = await this.#endpoints(config);
    const sessions: SessionsConfig = { endpoints, clientId: config.clientId, accountLabel: PROVIDER_LABEL };
    return new SessionStore(this.#secrets, sessions, fetchImpl);
  }

  /**
   * What the editor already has, refreshed if it was stale.
   *
   * A session that does not carry every scope asked for is not returned. The editor then offers
   * a sign-in, which is the correct thing to happen when a seat holds a consult grant and a band
   * needs a constructor one.
   */
  async getSessions(scopes: readonly string[] | undefined): Promise<vscode.AuthenticationSession[]> {
    let config: FabricConfig;
    try {
      config = currentConfig();
    } catch {
      // Unconfigured is not an error to raise here; it simply means there is nothing signed in.
      return [];
    }

    try {
      const store = await this.#store(config);
      const session = scopes === undefined ? await store.current() : await store.matching(scopes);
      if (session === null) return [];
      log(`getSessions → ${describeSession(session)}`);
      return [toAuthenticationSession(session)];
    } catch (err) {
      log(`getSessions could not produce a usable session: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  async createSession(scopes: readonly string[]): Promise<vscode.AuthenticationSession> {
    const config = currentConfig();
    const endpoints = await this.#endpoints(config);
    const requested = scopes.length === 0 ? [CONSTRUCTOR_ROLE] : [...scopes];

    const pkce = createPkce();
    const state = createState();
    const url = authorizationUrl({
      endpoints,
      clientId: config.clientId,
      redirectUri: this.#redirectUri,
      challenge: pkce.challenge,
      state,
      scopes: requested,
    });

    const code = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Signing in to ${PROVIDER_LABEL}…`,
        cancellable: true,
      },
      async (_progress, token) => this.#awaitCallback(url, state, token),
    );

    const grant = await exchangeCode(
      { endpoints, clientId: config.clientId, redirectUri: this.#redirectUri, code, verifier: pkce.verifier },
      fetchImpl,
    );

    const sessions: SessionsConfig = { endpoints, clientId: config.clientId, accountLabel: PROVIDER_LABEL };
    const session = await acceptGrant(this.#secrets, sessions, fetchImpl, grant, requested, randomUUID());

    log(`createSession → ${describeSession(session)}`);
    this.#changed.fire({ added: [toAuthenticationSession(session)], removed: [], changed: [] });
    return toAuthenticationSession(session);
  }

  async #awaitCallback(url: string, state: string, cancellation: vscode.CancellationToken): Promise<string> {
    const opened = await vscode.env.openExternal(vscode.Uri.parse(url));
    if (!opened) {
      throw new OAuthError('browser_refused', 'the authorization page could not be opened');
    }

    return new Promise<string>((resolve, reject) => {
      const finish = (): void => {
        pending.delete(state);
        clearTimeout(timer);
        subscription.dispose();
      };
      const timer = setTimeout(() => {
        finish();
        reject(new OAuthError('timeout', 'the sign-in was not completed in time'));
      }, SIGN_IN_TIMEOUT_MS);
      const subscription = cancellation.onCancellationRequested(() => {
        finish();
        reject(new OAuthError('cancelled', 'the sign-in was cancelled'));
      });

      pending.set(state, {
        resolve: (code) => {
          finish();
          resolve(code);
        },
        reject: (err) => {
          finish();
          reject(err);
        },
      });
    });
  }

  /**
   * Sign out.
   *
   * The refresh token is presented to the fabric's revoke path, which kills the family it was
   * issued from — an access token that outlived the sign-out that removed it would make the word
   * meaningless. The local session is then dropped whether or not the fabric could be reached.
   */
  async removeSession(sessionId: string): Promise<void> {
    let config: FabricConfig | null = null;
    try {
      config = currentConfig();
    } catch {
      config = null;
    }

    let removed: vscode.AuthenticationSession[] = [];
    if (config === null) {
      await clearSession(this.#secrets);
      log(`removeSession ${sessionId} — no configuration to revoke against; the local session was dropped`);
    } else {
      const store = await this.#store(config);
      const before = await store.read();
      const { revoked, hadSession } = await store.signOut();
      if (hadSession && before !== null) {
        removed = [toAuthenticationSession(before)];
      }
      log(
        `removeSession ${sessionId} — refresh token ${revoked ? 'presented and revoked' : 'not acknowledged by the fabric'}; the local session was dropped`,
      );
    }
    this.#changed.fire({ added: [], removed, changed: [] });
  }
}

function reportProblem(err: unknown): void {
  if (err instanceof ConfigurationError) {
    void vscode.window
      .showErrorMessage(err.message, 'Open settings')
      .then((choice) => {
        if (choice === 'Open settings') {
          void vscode.commands.executeCommand('workbench.action.openSettings', CONFIG_SECTION);
        }
      });
    return;
  }
  if (err instanceof RoleNotGrantedError) {
    void vscode.window.showErrorMessage(`Mew’d fabric: ${err.message}`);
    log(`role refused — granted [${err.granted.join(' ')}], asked for [${err.requested.join(' ')}]`);
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  void vscode.window.showErrorMessage(`Mew’d fabric: ${message}`);
  log(`sign-in failed: ${message}`);
}

export function activate(context: vscode.ExtensionContext): void {
  const redirectUri = `${vscode.env.uriScheme}://${EXTENSION_ID}${CALLBACK_PATH}`;
  const provider = new MewdAuthenticationProvider(context.secrets, redirectUri);

  context.subscriptions.push(
    output,
    provider,
    vscode.window.registerUriHandler(new FabricUriHandler()),
    vscode.authentication.registerAuthenticationProvider(PROVIDER_ID, PROVIDER_LABEL, provider, {
      supportsMultipleAccounts: false,
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mewdFabric.signIn', async () => {
      try {
        await vscode.authentication.getSession(PROVIDER_ID, [CONSTRUCTOR_ROLE], { createIfNone: true });
      } catch (err) {
        reportProblem(err);
      }
    }),
    vscode.commands.registerCommand('mewdFabric.signOut', async () => {
      const session = await vscode.authentication.getSession(PROVIDER_ID, [CONSTRUCTOR_ROLE], {
        createIfNone: false,
      });
      if (session === undefined) {
        void vscode.window.showInformationMessage('Mew’d fabric: this editor is not signed in.');
        return;
      }
      await provider.removeSession(session.id);
      void vscode.window.showInformationMessage('Mew’d fabric: signed out, and the refresh lineage revoked.');
    }),
    vscode.commands.registerCommand('mewdFabric.showLog', () => {
      output.show(true);
    }),
  );

  // A change of fabric or of client id invalidates everything held against the old one.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration(BASE_URL_SETTING) && !event.affectsConfiguration(CLIENT_ID_SETTING)) return;
      log('the fabric settings changed — the stored session no longer belongs to what is configured');
      void clearSession(context.secrets).then(() => {
        void vscode.window.showInformationMessage(
          'Mew’d fabric: the settings changed, so the stored session was dropped. Sign in again when you need one.',
        );
      });
    }),
  );
}

export function deactivate(): void {
  pending.clear();
}
