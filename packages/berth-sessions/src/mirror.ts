/**
 * The mirror: one read of the fabric, turned into what the session view should show.
 *
 * This is the whole of the plank's behaviour, written without the editor API so that it can be
 * driven by a payload instead of by a running desktop. `readMirror` is the only function that
 * sees a bearer, and a bearer is the only thing it does not return: every branch below hands
 * back berths, or a reason, and there is no shape in `Mirror` that a token could travel inside.
 * The test suite asserts that by serialising the result and searching it, which is a duller
 * check than reading the types and a more honest one.
 *
 * The states are deliberately distinct. "No fabric configured", "not signed in" and "the fabric
 * said no" are three different situations with three different remedies, and collapsing them
 * into an empty list would leave the operator looking at a view that says nothing is happening
 * when in fact nothing is being read.
 */

import type { Berth } from './berths.js';
import { toBerths } from './berths.js';
import { fetchBerths, type FetchLike } from './client.js';

export interface MirrorDeps {
  /** The operator's `mewd.fabric.baseUrl`, or `null` when they have not set one. */
  readonly baseUrl: () => string | null;
  /** The P1 bearer, from the extension host. Never stored, never passed on. */
  readonly bearer: () => Promise<string | null>;
  readonly fetchImpl: FetchLike;
  readonly now?: () => Date;
}

export type Mirror =
  | { readonly kind: 'berths'; readonly berths: readonly Berth[]; readonly at: string }
  /** No `mewd.fabric.baseUrl`. There is nothing to mirror because nothing has been named. */
  | { readonly kind: 'unconfigured'; readonly reason: string }
  /** No session. The remedy belongs to `fabric-auth`; this plank only says so. */
  | { readonly kind: 'signed-out'; readonly reason: string }
  /** A session the fabric no longer accepts, or one it accepts and declines this route for. */
  | { readonly kind: 'unauthorized'; readonly reason: string }
  | { readonly kind: 'error'; readonly reason: string };

export const UNCONFIGURED =
  'Set mewd.fabric.baseUrl to the fabric this editor should read. There is no default — this pack is public and carries no host of anyone’s.';

export const SIGNED_OUT =
  'This editor is not signed in to the Mew’d fabric, so there are no berths to mirror. Sign in from the Mew’d fabric plank.';

export const UNAUTHORIZED =
  'The Mew’d fabric did not accept this editor’s session for the berths. Signing in again is the remedy, and it belongs to the Mew’d fabric plank.';

/**
 * One read, start to finish.
 *
 * The bearer is asked for without `createIfNone`, and the caller is expected to have obtained it
 * the same way. A session view is refreshed whenever the editor feels like refreshing it, and a
 * view that could begin an authorization flow on its own would make a window-layout change into
 * a browser tab.
 */
export async function readMirror(deps: MirrorDeps): Promise<Mirror> {
  const origin = deps.baseUrl();
  if (origin === null) return { kind: 'unconfigured', reason: UNCONFIGURED };

  const bearer = await deps.bearer();
  if (bearer === null) return { kind: 'signed-out', reason: SIGNED_OUT };

  const result =
    deps.now === undefined
      ? await fetchBerths(origin, bearer, deps.fetchImpl)
      : await fetchBerths(origin, bearer, deps.fetchImpl, deps.now);

  switch (result.kind) {
    case 'unauthorized':
      return { kind: 'unauthorized', reason: UNAUTHORIZED };
    case 'error':
      return { kind: 'error', reason: result.message };
    case 'berths':
      return { kind: 'berths', berths: toBerths(result.body), at: result.at };
  }
}

/**
 * The line the view shows when it is holding no berths.
 *
 * A session list that is empty because nothing is running and one that is empty because nothing
 * could be read look identical, and only one of them is good news.
 */
export function emptyReason(mirror: Mirror): string | null {
  switch (mirror.kind) {
    case 'berths':
      return mirror.berths.length === 0 ? 'The fabric is holding no sessions.' : null;
    case 'unconfigured':
    case 'signed-out':
    case 'unauthorized':
    case 'error':
      return mirror.reason;
  }
}
