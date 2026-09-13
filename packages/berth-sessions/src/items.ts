/**
 * A berth, projected into the fields a session item shows.
 *
 * The editor's item type wants a `Uri`, an `IconPath` and an enum, all of which are editor
 * objects. This file produces none of them. It produces the *values* that go into them — a path,
 * a label, a line of detail, a state word — and `extension.ts` does the one-line conversion.
 * Splitting it that way is what lets the interesting claim be tested without an editor:
 *
 *   - the projection has no field a credential could occupy, and
 *   - the projection has no field a host could occupy.
 *
 * The second matters more than it looks. The obvious way to give a mirrored session a stable
 * identity is to make its resource the URL it came from, and that URL contains the operator's
 * fabric origin. It would then be in a `Uri` the editor keeps, shows on hover, and may write
 * into its own storage — an estate's address, surfaced by a plank whose whole purpose is to be
 * safe to look at. So the resource is built from the fabric's session id and the scheme below,
 * and the origin stays in the extension host where the request was made.
 */

import type { Berth, BerthState } from './berths.js';

/**
 * The scheme mirrored berths are addressed under.
 *
 * Chosen rather than reused: a scheme the editor already resolves would invite it to try, and
 * there is nothing behind these resources to open. This plank registers no content provider —
 * it mirrors a list, it does not serve a transcript.
 */
export const BERTH_SCHEME = 'mewd-berth';

/** The status words the editor's session enum is built from, kept as strings on this side. */
export type ItemStatus = 'in-progress' | 'needs-input' | 'completed' | 'failed' | 'none';

export interface ItemFields {
  /** Path component of the item's resource. Identity only; never an origin. */
  readonly path: string;
  readonly label: string;
  /** The line under the label, or nothing. */
  readonly description: string | null;
  readonly tooltip: string;
  readonly status: ItemStatus;
  readonly created: number | null;
  readonly lastRequestEnded: number | null;
}

const STATUS_OF: Readonly<Record<BerthState, ItemStatus>> = {
  working: 'in-progress',
  waiting: 'needs-input',
  done: 'completed',
  failed: 'failed',
  // Not `completed`. A berth whose state this plank could not read has not been shown to have
  // finished, and a check that cannot read its input reports unknown rather than pass.
  unknown: 'none',
};

/** How each state reads in the hover, so a reader is never left to infer it from a colour. */
const STATE_WORDS: Readonly<Record<BerthState, string>> = {
  working: 'working',
  waiting: 'waiting on something',
  done: 'finished',
  failed: 'ended badly',
  unknown: 'in a state this mirror could not read',
};

/**
 * Percent-encode the fabric's session id into a path.
 *
 * `encodeURIComponent` and then a leading slash, so an id containing a slash cannot invent a
 * path segment and an id containing a `?` cannot invent a query.
 */
export function pathFor(id: string): string {
  return `/${encodeURIComponent(id)}`;
}

export function itemFieldsFor(berth: Berth): ItemFields {
  return {
    path: pathFor(berth.id),
    label: berth.label,
    description: berth.detail,
    tooltip: tooltipFor(berth),
    status: STATUS_OF[berth.state],
    created: berth.startedAt,
    lastRequestEnded: berth.updatedAt,
  };
}

/**
 * The hover.
 *
 * It says what the berth is doing and then says what this view is: a mirror, read-only, of a
 * fabric whose name it does not print. The second half is there because the first half looks
 * exactly like every other session row in the editor, and every other session row can be acted
 * on. A reader who assumes the same of this one has been misled by the surface, and the tooltip
 * is where that gets corrected.
 */
export function tooltipFor(berth: Berth): string {
  const lines = [`${berth.label} — ${STATE_WORDS[berth.state]}.`];
  if (berth.detail !== null) lines.push(berth.detail);
  lines.push('A read-only mirror of a Mew’d berth. Nothing here changes the session.');
  return lines.join('\n');
}

export function itemFieldsForAll(berths: readonly Berth[]): ItemFields[] {
  return berths.map(itemFieldsFor);
}
