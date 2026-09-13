/**
 * The berth read — the one place in this plank that puts a bearer on a request.
 *
 * It runs in the **extension host**, for the same reason the P1 band's fetch does: the host
 * holds the token and makes the request, and everything downstream is handed the answer. Here
 * the thing downstream is not a webview but the editor's own session view, which makes the rule
 * stricter rather than looser — items handed to the editor are objects the editor keeps, passes
 * across its own boundaries and may render in places this plank never sees. A bearer on one of
 * them would be a bearer in all of those places.
 *
 * The request this file builds is a GET and there is no code path here that builds anything
 * else. That is what makes the mirror read-only at the transport rather than only by convention,
 * and `pack-lint` now fails a session-mirror plank whose source says otherwise.
 *
 * `fetch` is injected rather than reached for, so the test that asserts the header is looking at
 * the real request this code builds.
 */

import { berthsUrl } from './berths.js';

export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown>; text: () => Promise<string> }>;

export interface BerthRequest {
  readonly url: string;
  /** The only method this plank has. There is no branch that widens it. */
  readonly method: 'GET';
  readonly headers: Record<string, string>;
}

/**
 * `unauthorized` is not an error. It is the state in which the mirror shows nothing and says
 * why, and the operator's remedy is the sign-in the P1 plank already owns. This plank offers no
 * sign-in of its own: a session list that could start an authorization flow would turn the act
 * of opening a view into a browser tab.
 */
export type BerthResult =
  | { readonly kind: 'berths'; readonly body: unknown; readonly at: string }
  | { readonly kind: 'unauthorized' }
  | { readonly kind: 'error'; readonly status: number; readonly message: string };

export const BEARER_SCHEME = 'Bearer';

export function berthRequest(baseUrl: string, bearer: string): BerthRequest {
  return {
    url: berthsUrl(baseUrl),
    method: 'GET',
    headers: {
      authorization: `${BEARER_SCHEME} ${bearer}`,
      accept: 'application/json',
    },
  };
}

export async function fetchBerths(
  baseUrl: string,
  bearer: string,
  fetchImpl: FetchLike,
  now: () => Date = () => new Date(),
): Promise<BerthResult> {
  const request = berthRequest(baseUrl, bearer);

  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await fetchImpl(request.url, { method: request.method, headers: request.headers });
  } catch (err) {
    return {
      kind: 'error',
      status: 0,
      message: `the fabric could not be reached: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (response.status === 401) return { kind: 'unauthorized' };

  if (response.status === 403) {
    return {
      kind: 'error',
      status: 403,
      message:
        'the fabric knows this session and declined the route — the seat does not hold the role the berths are a view of. Signing in again will not change that.',
    };
  }

  if (!response.ok) {
    let detail = '';
    try {
      detail = (await response.text()).slice(0, 200);
    } catch {
      detail = '';
    }
    return {
      kind: 'error',
      status: response.status,
      message: detail === '' ? `the fabric answered ${response.status}` : `${response.status}: ${detail}`,
    };
  }

  try {
    return { kind: 'berths', body: await response.json(), at: now().toISOString() };
  } catch {
    return { kind: 'error', status: response.status, message: 'the route answered with something that is not JSON' };
  }
}
