/**
 * The only thing that crosses between the extension host and a band webview.
 *
 * Four messages out, three messages in, all of them plain data. No token, no URL, no header and
 * no handle to anything that could make a request: a band webview is handed rows and a state,
 * and the most it can ask for in return is "again, please" or "let me sign in".
 *
 * `signIn` in particular is a *message*, not a link. The host turns it into a call to the
 * authentication provider. A webview that could navigate the operator somewhere to sign in would
 * be a webview that could navigate the operator somewhere.
 */

import type { BandId } from './bands.js';
import type { BandResult } from './client.js';
import { toRows, type Row } from './rows.js';

export type HostMessage =
  | { readonly type: 'loading'; readonly band: BandId }
  | { readonly type: 'data'; readonly band: BandId; readonly rows: readonly Row[]; readonly at: string }
  | { readonly type: 'signIn'; readonly band: BandId; readonly reason: string }
  | { readonly type: 'unconfigured'; readonly band: BandId; readonly reason: string }
  | { readonly type: 'error'; readonly band: BandId; readonly status: number; readonly message: string };

export type ViewMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'refresh' }
  | { readonly type: 'signIn' };

const VIEW_TYPES = new Set(['ready', 'refresh', 'signIn']);

/** Nothing is trusted on the way in, including the shape of it. */
export function isViewMessage(value: unknown): value is ViewMessage {
  if (typeof value !== 'object' || value === null) return false;
  const type = (value as { type?: unknown }).type;
  return typeof type === 'string' && VIEW_TYPES.has(type);
}

export const SIGN_IN_REASON =
  'the fabric answered 401 — this editor is not holding a session it will accept';

export function hostMessageFor(band: BandId, result: BandResult): HostMessage {
  switch (result.kind) {
    case 'data':
      return { type: 'data', band, rows: toRows(result.body), at: result.at };
    case 'unauthorized':
      return { type: 'signIn', band, reason: SIGN_IN_REASON };
    case 'error':
      return { type: 'error', band, status: result.status, message: result.message };
  }
}
