/**
 * The band fetch — the one place in this plank that puts a bearer on a request.
 *
 * It runs in the **extension host**. That is the whole architecture of this plank in one
 * sentence: the host holds the token and makes the request, the webview is handed the answer.
 * A webview that could fetch the fabric would be a webview that had to hold a credential, and a
 * credential in a page is a credential in whatever that page ends up rendering.
 *
 * `fetch` is injected rather than reached for, so the test that asserts the `Authorization`
 * header is looking at the real request this code builds.
 */

import type { Band } from './bands.js';
import { urlFor } from './bands.js';

export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown>; text: () => Promise<string> }>;

export interface BandRequest {
  readonly url: string;
  readonly method: 'GET';
  readonly headers: Record<string, string>;
}

/**
 * `unauthorized` is what a 401 becomes, and it is deliberately not an error: it is the one
 * answer the view responds to with an affordance rather than a message.
 *
 * A 403 is an error, and a different one. It means the fabric knows who this is and has decided
 * the answer is no — signing in again would be theatre, so the view says what happened instead.
 */
export type BandResult =
  | { readonly kind: 'data'; readonly body: unknown; readonly at: string }
  | { readonly kind: 'unauthorized' }
  | { readonly kind: 'error'; readonly status: number; readonly message: string };

export const BEARER_SCHEME = 'Bearer';

export function bandRequest(baseUrl: string, band: Band, bearer: string): BandRequest {
  return {
    url: urlFor(baseUrl, band),
    method: 'GET',
    headers: {
      authorization: `${BEARER_SCHEME} ${bearer}`,
      accept: 'application/json',
    },
  };
}

export async function fetchBand(
  baseUrl: string,
  band: Band,
  bearer: string,
  fetchImpl: FetchLike,
  now: () => Date = () => new Date(),
): Promise<BandResult> {
  const request = bandRequest(baseUrl, band, bearer);

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
        'the fabric knows this session and declined the route — the seat does not hold the role this band is a view of. Signing in again will not change that.',
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
    return { kind: 'data', body: await response.json(), at: now().toISOString() };
  } catch {
    return { kind: 'error', status: response.status, message: 'the route answered with something that is not JSON' };
  }
}
