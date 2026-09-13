/**
 * Where the tokens live, and the small state machine around them.
 *
 * The tokens live in `SecretStorage` and nowhere else — not in `globalState`, not in a file
 * beside the extension, not in a variable that outlives the call that needed it. `SecretStore`
 * below is that interface written out structurally, so this file imports no editor API and the
 * whole lineage can be exercised against a mock.
 *
 * `describeSession` exists because the temptation to log a session is real and the cost of
 * giving in to it is a token in somebody's output pane. There is one way to render a session as
 * text, it never contains a token, and a test holds it to that.
 */

import {
  CONSTRUCTOR_ROLE,
  OAuthError,
  refreshGrant,
  revokeGrant,
  satisfies,
  type Endpoints,
  type FetchLike,
  type TokenGrant,
} from './oauth.js';

/** `vscode.SecretStorage`, structurally. */
export interface SecretStore {
  get(key: string): Thenable<string | undefined>;
  store(key: string, value: string): Thenable<void>;
  delete(key: string): Thenable<void>;
}

/** One key. One session. The provider does not support multiple accounts. */
export const SECRET_KEY = 'mewd.fabric.session';

/** Refresh this far before the fabric would have stopped accepting the token anyway. */
export const REFRESH_SKEW_MS = 60_000;

export interface StoredSession {
  readonly id: string;
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly expiresAt: number | null;
  /** What the fabric granted. Never what was asked for. */
  readonly scopes: readonly string[];
  readonly account: { readonly id: string; readonly label: string };
}

export function sessionFromGrant(grant: TokenGrant, id: string, accountLabel: string): StoredSession {
  return {
    id,
    accessToken: grant.accessToken,
    refreshToken: grant.refreshToken,
    expiresAt: grant.expiresAt,
    scopes: [...grant.scopes],
    account: { id: 'mewd.fabric', label: accountLabel },
  };
}

/** True when the access token is past its life, or close enough that using it would be a gamble. */
export function isStale(session: StoredSession, now: number, skewMs = REFRESH_SKEW_MS): boolean {
  return session.expiresAt !== null && session.expiresAt - skewMs <= now;
}

export function isConstructor(session: StoredSession): boolean {
  return session.scopes.includes(CONSTRUCTOR_ROLE);
}

/**
 * A session as text. Never a token, not even a prefix of one — a prefix is enough to correlate
 * two logs, and there is nothing a prefix would have told you that the scopes do not.
 */
export function describeSession(session: StoredSession): string {
  const scopes = session.scopes.length === 0 ? 'no scopes granted' : session.scopes.join(' ');
  const expiry = session.expiresAt === null ? 'no stated expiry' : new Date(session.expiresAt).toISOString();
  const refresh = session.refreshToken === null ? 'no refresh lineage' : 'refresh lineage held';
  return `session ${session.id} — ${scopes}; ${expiry}; ${refresh}`;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Read what is in the store, or `null` if there is nothing readable there. */
export async function readSession(store: SecretStore): Promise<StoredSession | null> {
  const raw = await store.get(SECRET_KEY);
  if (raw === undefined) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (!isObject(parsed)) return null;
  const { id, accessToken, refreshToken, expiresAt, scopes, account } = parsed;
  if (typeof id !== 'string' || typeof accessToken !== 'string') return null;
  if (!isObject(account) || typeof account['id'] !== 'string' || typeof account['label'] !== 'string') {
    return null;
  }
  return {
    id,
    accessToken,
    refreshToken: typeof refreshToken === 'string' ? refreshToken : null,
    expiresAt: typeof expiresAt === 'number' ? expiresAt : null,
    scopes: Array.isArray(scopes) ? scopes.filter((s): s is string => typeof s === 'string') : [],
    account: { id: account['id'], label: account['label'] },
  };
}

export async function writeSession(store: SecretStore, session: StoredSession): Promise<void> {
  await store.store(SECRET_KEY, JSON.stringify(session));
}

export async function clearSession(store: SecretStore): Promise<void> {
  await store.delete(SECRET_KEY);
}

export interface SessionsConfig {
  readonly endpoints: Endpoints;
  readonly clientId: string;
  readonly accountLabel: string;
}

/** Raised when the fabric issued a grant that does not carry the role the seat asked for. */
export class RoleNotGrantedError extends Error {
  readonly granted: readonly string[];
  readonly requested: readonly string[];
  constructor(granted: readonly string[], requested: readonly string[]) {
    const got = granted.length === 0 ? 'nothing it was willing to name' : granted.join(' ');
    super(
      `the fabric granted ${got}; this seat asked for ${requested.join(' ')}. A role is the fabric's to give, not this plank's to assume.`,
    );
    this.name = 'RoleNotGrantedError';
    this.granted = [...granted];
    this.requested = [...requested];
  }
}

/**
 * Take a fresh grant, or refuse it.
 *
 * A grant that does not carry what was asked for is not stored and not returned. It is also not
 * left alive on the fabric: tokens were issued to this client and this client has decided not to
 * use them, so the lineage is revoked on the way out. Keeping a session the seat has already
 * decided is insufficient is how a `role:consult` grant quietly becomes the thing a constructor
 * band was rendered from.
 */
export async function acceptGrant(
  store: SecretStore,
  config: SessionsConfig,
  fetchImpl: FetchLike,
  grant: TokenGrant,
  requested: readonly string[],
  sessionId: string,
): Promise<StoredSession> {
  const session = sessionFromGrant(grant, sessionId, config.accountLabel);
  if (!satisfies(session.scopes, requested)) {
    if (session.refreshToken !== null) {
      await revokeGrant(
        { endpoints: config.endpoints, clientId: config.clientId, refreshToken: session.refreshToken },
        fetchImpl,
      );
    }
    throw new RoleNotGrantedError(session.scopes, requested);
  }
  await writeSession(store, session);
  return session;
}

/**
 * The stored session, kept fresh.
 *
 * `current` is the only way anything gets a bearer, and it refreshes silently when the token it
 * finds is stale. A refresh that fails is not a bearer with a shrug: the session is dropped and
 * the caller is told there is none, so the next thing that happens is a sign-in rather than a
 * 401 the user cannot explain.
 */
export class SessionStore {
  readonly #store: SecretStore;
  readonly #config: SessionsConfig;
  readonly #fetch: FetchLike;
  #inFlight: Promise<StoredSession | null> | null = null;

  constructor(store: SecretStore, config: SessionsConfig, fetchImpl: FetchLike) {
    this.#store = store;
    this.#config = config;
    this.#fetch = fetchImpl;
  }

  async read(): Promise<StoredSession | null> {
    return readSession(this.#store);
  }

  async write(session: StoredSession): Promise<void> {
    await writeSession(this.#store, session);
  }

  /**
   * The stored session, refreshed if it needed it. Concurrent callers share one refresh: four
   * bands waking up together must not spend four refresh tokens on the same lineage.
   */
  async current(now: number = Date.now()): Promise<StoredSession | null> {
    this.#inFlight ??= this.#currentUncoalesced(now).finally(() => {
      this.#inFlight = null;
    });
    return this.#inFlight;
  }

  async #currentUncoalesced(now: number): Promise<StoredSession | null> {
    const session = await readSession(this.#store);
    if (session === null) return null;
    if (!isStale(session, now)) return session;
    if (session.refreshToken === null) {
      await clearSession(this.#store);
      return null;
    }

    let grant: TokenGrant;
    try {
      grant = await refreshGrant(
        { endpoints: this.#config.endpoints, clientId: this.#config.clientId, refreshToken: session.refreshToken },
        this.#fetch,
        now,
      );
    } catch (err) {
      // The lineage is gone, or the fabric is unreachable. Either way this bearer is not usable,
      // and holding a dead session would turn a sign-in prompt into an unexplained 401.
      await clearSession(this.#store);
      throw err instanceof OAuthError ? err : new OAuthError('refresh_failed', String(err));
    }

    const rotated = sessionFromGrant(grant, session.id, this.#config.accountLabel);
    await writeSession(this.#store, rotated);
    return rotated;
  }

  /** The session, if it carries every scope asked for. Otherwise nothing. */
  async matching(scopes: readonly string[], now: number = Date.now()): Promise<StoredSession | null> {
    const session = await this.current(now);
    if (session === null) return null;
    return satisfies(session.scopes, scopes) ? session : null;
  }

  /**
   * Sign out: present the refresh token to the fabric's revoke path, then drop the session.
   *
   * The order matters. Revoking first means the fabric has been told before the only copy of the
   * token is thrown away; dropping afterwards, unconditionally, means a fabric that cannot be
   * reached does not leave a signed-in editor behind.
   */
  async signOut(): Promise<{ revoked: boolean; hadSession: boolean }> {
    const session = await readSession(this.#store);
    if (session === null) return { revoked: false, hadSession: false };
    let revoked = false;
    if (session.refreshToken !== null) {
      revoked = await revokeGrant(
        { endpoints: this.#config.endpoints, clientId: this.#config.clientId, refreshToken: session.refreshToken },
        this.#fetch,
      );
    }
    await clearSession(this.#store);
    return { revoked, hadSession: true };
  }
}
