/**
 * The OAuth 2.1 client, as plain functions over an injected `fetch`.
 *
 * Four shapes, and no more: discover, authorize, exchange, refresh, revoke.
 *
 * Three things this client will not do, each of them a deliberate absence rather than an
 * omission:
 *
 *   - **No dynamic client registration.** The fabric issues one public client id; the operator
 *     puts it in settings. A client that can register itself can register itself again, and the
 *     set of clients that may ask for a constructor role stops being a thing anyone decided.
 *   - **No client secret.** This is a public client on somebody's laptop. A secret shipped to a
 *     public client is not a secret, and carrying one would be a lie about the security model
 *     rather than a contribution to it.
 *   - **No role it granted itself.** The scopes on a session come from what the token response
 *     says was granted, never from what was asked for. See `grantedScopes`.
 *
 * The base URL and the client id both come from the operator's settings. Neither appears here.
 */

/** The role a constructor seat needs. Requested; only ever held if the fabric grants it. */
export const CONSTRUCTOR_ROLE = 'role:constructor';

/** RFC 8414. Tried first; the conventional paths below are the fallback. */
export const METADATA_PATH = '/.well-known/oauth-authorization-server';

export interface Endpoints {
  readonly authorization: string;
  readonly token: string;
  readonly revocation: string;
}

export class OAuthError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'OAuthError';
    this.code = code;
  }
}

/** A `fetch` as this client uses it. Structural, so a test can pass a function and nothing else. */
export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

export function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/** `<base>/oauth/{authorize,token,revoke}` — used when the fabric publishes no metadata. */
export function defaultEndpoints(baseUrl: string): Endpoints {
  const base = trimTrailingSlash(baseUrl);
  return {
    authorization: `${base}/oauth/authorize`,
    token: `${base}/oauth/token`,
    revocation: `${base}/oauth/revoke`,
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function stringField(o: Record<string, unknown>, key: string): string | undefined {
  const v = o[key];
  return typeof v === 'string' && v !== '' ? v : undefined;
}

/**
 * Ask the fabric where its endpoints are, and fall back to the conventional paths when it does
 * not say. A metadata document that answers some questions and not others is honoured for the
 * ones it answers; the rest fall back individually.
 */
export async function discoverEndpoints(baseUrl: string, fetchImpl: FetchLike): Promise<Endpoints> {
  const fallback = defaultEndpoints(baseUrl);
  let metadata: unknown;
  try {
    const response = await fetchImpl(`${trimTrailingSlash(baseUrl)}${METADATA_PATH}`, {
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return fallback;
    metadata = await response.json();
  } catch {
    return fallback;
  }
  if (!isObject(metadata)) return fallback;
  return {
    authorization: stringField(metadata, 'authorization_endpoint') ?? fallback.authorization,
    token: stringField(metadata, 'token_endpoint') ?? fallback.token,
    revocation: stringField(metadata, 'revocation_endpoint') ?? fallback.revocation,
  };
}

export interface AuthorizationRequest {
  readonly endpoints: Endpoints;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly challenge: string;
  readonly state: string;
  readonly scopes: readonly string[];
}

export function authorizationUrl(request: AuthorizationRequest): string {
  const url = new URL(request.endpoints.authorization);
  const params = url.searchParams;
  params.set('response_type', 'code');
  params.set('client_id', request.clientId);
  params.set('redirect_uri', request.redirectUri);
  params.set('scope', request.scopes.join(' '));
  params.set('state', request.state);
  params.set('code_challenge', request.challenge);
  params.set('code_challenge_method', 'S256');
  return url.toString();
}

export interface TokenGrant {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  /** Epoch milliseconds, or `null` when the fabric did not say. */
  readonly expiresAt: number | null;
  /**
   * What the fabric said it granted. Never what was asked for: see `grantedScopes`.
   */
  readonly scopes: readonly string[];
  readonly tokenType: string;
}

/**
 * The granted scopes, taken from the token response and from nowhere else.
 *
 * RFC 6749 §5.1 lets a server omit `scope` to mean "identical to the scope requested". This
 * client does not take that reading, because the thing being decided here is a *role*, and a
 * role the client filled in for itself is not a role anybody granted. A response that does not
 * say what it granted has granted nothing this plank will claim — the session is kept, and it
 * simply does not satisfy a request for `role:constructor`.
 *
 * That is the same discipline as everywhere else in this pack: a check that cannot read its
 * input reports unknown, not pass.
 */
export function grantedScopes(response: Record<string, unknown>): string[] {
  const scope = response['scope'];
  if (typeof scope !== 'string') return [];
  return scope.split(/\s+/).filter((s) => s !== '');
}

export function hasRole(scopes: readonly string[], role: string): boolean {
  return scopes.includes(role);
}

/** Every scope the caller asked for is one the fabric granted. */
export function satisfies(granted: readonly string[], requested: readonly string[]): boolean {
  return requested.every((scope) => granted.includes(scope));
}

async function postForm(
  fetchImpl: FetchLike,
  endpoint: string,
  form: Record<string, string>,
): Promise<Record<string, unknown>> {
  const body = new URLSearchParams(form).toString();
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body,
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const code = isObject(payload) ? (stringField(payload, 'error') ?? 'http_error') : 'http_error';
    const description = isObject(payload) ? stringField(payload, 'error_description') : undefined;
    throw new OAuthError(code, description ?? `the fabric answered ${response.status}`);
  }
  if (!isObject(payload)) {
    throw new OAuthError('invalid_response', 'the token endpoint did not answer with a JSON object');
  }
  return payload;
}

function toGrant(payload: Record<string, unknown>, now: number): TokenGrant {
  const accessToken = stringField(payload, 'access_token');
  if (accessToken === undefined) {
    throw new OAuthError('invalid_response', 'the token response carried no access_token');
  }
  const expiresIn = payload['expires_in'];
  return {
    accessToken,
    refreshToken: stringField(payload, 'refresh_token') ?? null,
    expiresAt: typeof expiresIn === 'number' && Number.isFinite(expiresIn) ? now + expiresIn * 1000 : null,
    scopes: grantedScopes(payload),
    tokenType: stringField(payload, 'token_type') ?? 'Bearer',
  };
}

export interface CodeExchange {
  readonly endpoints: Endpoints;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly code: string;
  readonly verifier: string;
}

export async function exchangeCode(
  exchange: CodeExchange,
  fetchImpl: FetchLike,
  now: number = Date.now(),
): Promise<TokenGrant> {
  const payload = await postForm(fetchImpl, exchange.endpoints.token, {
    grant_type: 'authorization_code',
    client_id: exchange.clientId,
    redirect_uri: exchange.redirectUri,
    code: exchange.code,
    code_verifier: exchange.verifier,
  });
  return toGrant(payload, now);
}

export interface RefreshRequest {
  readonly endpoints: Endpoints;
  readonly clientId: string;
  readonly refreshToken: string;
}

/**
 * Present the refresh token, take back whatever the fabric issues.
 *
 * OAuth 2.1 rotates refresh tokens for public clients, so the response usually carries a new one
 * and the old one is dead the moment this returns. The caller writes the whole grant back; it
 * must not keep the token it presented.
 */
export async function refreshGrant(
  request: RefreshRequest,
  fetchImpl: FetchLike,
  now: number = Date.now(),
): Promise<TokenGrant> {
  const payload = await postForm(fetchImpl, request.endpoints.token, {
    grant_type: 'refresh_token',
    client_id: request.clientId,
    refresh_token: request.refreshToken,
  });
  return toGrant(payload, now);
}

export interface RevokeRequest {
  readonly endpoints: Endpoints;
  readonly clientId: string;
  readonly refreshToken: string;
}

/**
 * Sign-out presents the refresh token to the revoke path, which kills the whole family.
 *
 * Revoking the *refresh* token rather than the access token is the point: a refresh lineage that
 * survives a sign-out is a sign-out that did not happen. RFC 7009 tells the server to revoke the
 * other tokens issued from the same grant, and that is exactly the effect wanted here.
 *
 * Returns whether the fabric acknowledged. The caller drops the session either way — a local
 * sign-out that depended on the network reaching a host would be a sign-out you cannot perform
 * on a train.
 */
export async function revokeGrant(request: RevokeRequest, fetchImpl: FetchLike): Promise<boolean> {
  try {
    const response = await fetchImpl(request.endpoints.revocation, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: new URLSearchParams({
        client_id: request.clientId,
        token: request.refreshToken,
        token_type_hint: 'refresh_token',
      }).toString(),
    });
    return response.ok;
  } catch {
    return false;
  }
}
