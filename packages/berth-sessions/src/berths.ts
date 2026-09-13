/**
 * A berth, and the one route it is read from.
 *
 * This plank mirrors the Berths band into the editor's native Agent Sessions view. It is a
 * second *view* of a thing that already exists, not a second source of it: the route below is
 * the same `/dashboard/sessions` the P1 band reads, and the shape understood here is the same
 * shape that band already renders. A mirror that read a different route would be a second
 * opinion, and two opinions about what the supervisor is holding is worse than one.
 *
 * Nothing in this file imports the editor API. A berth is a label, a state and a note — plain
 * data, so the mapping from whatever the fabric answered into what the view shows can be
 * exercised against a payload rather than against a running editor.
 *
 * There is no field here for a credential, and that is deliberate rather than incidental: the
 * bearer is held by the extension host and never reaches this model, so an item cannot carry one
 * even by mistake. A test holds the model to that.
 */

/** The route. Identical to the P1 Berths band's, and a test asserts the two have not drifted. */
export const BERTHS_ROUTE = '/dashboard/sessions';

/**
 * The states a berth can be shown in.
 *
 * A small closed set, because the native view renders a status and the fabric's vocabulary is
 * not this plank's to define. Anything the fabric says that does not map lands on `unknown`,
 * which is shown as such — a state this plank cannot read is not the same as a state that is
 * fine, and rendering it as fine would be the mirror lying about its own reach.
 */
export type BerthState = 'working' | 'waiting' | 'done' | 'failed' | 'unknown';

export interface Berth {
  /** Stable identity within the fabric. Used to build the item's resource, and nothing else. */
  readonly id: string;
  /** What the operator reads first. */
  readonly label: string;
  readonly state: BerthState;
  /** One line under the label, or nothing. Never a host, never a token. */
  readonly detail: string | null;
  /** Milliseconds since the epoch, when the fabric said so in a form that could be read. */
  readonly startedAt: number | null;
  readonly updatedAt: number | null;
}

/** Keys the route might hang its list off, in the order they are looked for. */
const LIST_KEYS = ['sessions', 'items', 'entries', 'rows', 'results', 'data'] as const;

const ID_KEYS = ['id', 'session_id', 'sessionId', 'uuid', 'name'] as const;
const LABEL_KEYS = ['title', 'label', 'name', 'summary', 'subject', 'id'] as const;
const DETAIL_KEYS = ['detail', 'description', 'note', 'why', 'reason', 'task', 'path'] as const;
const STATE_KEYS = ['state', 'status', 'phase', 'kind'] as const;
const STARTED_KEYS = ['started_at', 'startedAt', 'created_at', 'createdAt', 'start'] as const;
const UPDATED_KEYS = ['updated_at', 'updatedAt', 'last_seen', 'lastSeen', 'at', 'end'] as const;

/**
 * The fabric's words for a state, grouped by what the view should show.
 *
 * Listed rather than guessed at by prefix: `running` and `runnable` differ by two letters and by
 * everything that matters, and a prefix match would have quietly called one the other.
 */
const STATE_WORDS: Readonly<Record<string, BerthState>> = {
  working: 'working',
  running: 'working',
  active: 'working',
  busy: 'working',
  'in-progress': 'working',
  in_progress: 'working',
  inprogress: 'working',
  started: 'working',

  waiting: 'waiting',
  blocked: 'waiting',
  pending: 'waiting',
  queued: 'waiting',
  idle: 'waiting',
  paused: 'waiting',
  'needs-input': 'waiting',
  needs_input: 'waiting',
  attention: 'waiting',

  done: 'done',
  complete: 'done',
  completed: 'done',
  finished: 'done',
  succeeded: 'done',
  success: 'done',
  ok: 'done',
  closed: 'done',

  failed: 'failed',
  failure: 'failed',
  error: 'failed',
  errored: 'failed',
  crashed: 'failed',
  cancelled: 'failed',
  canceled: 'failed',
  aborted: 'failed',
  timeout: 'failed',
  'timed-out': 'failed',
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function scalar(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return null;
}

function pick(o: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const found = scalar(o[key]);
    if (found !== null && found.trim() !== '') return found.trim();
  }
  return null;
}

/** A word from the fabric, as one of the states the view knows. Unreadable becomes `unknown`. */
export function toState(word: string | null): BerthState {
  if (word === null) return 'unknown';
  return STATE_WORDS[word.trim().toLowerCase()] ?? 'unknown';
}

/**
 * A timestamp, if it is one.
 *
 * Seconds and milliseconds are both plausible from a dashboard route and are told apart by
 * magnitude; anything else readable by `Date` is taken as written. A value that cannot be read
 * becomes `null` rather than `Date.now()`, because a berth stamped with the moment it was
 * rendered would read as fresh news about nothing.
 */
export function toEpochMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value <= 0) return null;
    return value < 1e12 ? Math.round(value * 1000) : Math.round(value);
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function pickStamp(o: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const stamp = toEpochMs(o[key]);
    if (stamp !== null) return stamp;
  }
  return null;
}

function berthFor(value: unknown, index: number): Berth {
  const ordinal = `#${index + 1}`;
  if (!isObject(value)) {
    const flat = scalar(value);
    return {
      id: flat ?? ordinal,
      label: flat ?? ordinal,
      state: 'unknown',
      detail: flat === null ? 'the route answered with an entry this mirror cannot read' : null,
      startedAt: null,
      updatedAt: null,
    };
  }

  const id = pick(value, ID_KEYS) ?? ordinal;
  const label = pick(value, LABEL_KEYS) ?? id;
  return {
    id,
    label,
    state: toState(pick(value, STATE_KEYS)),
    detail: pick(value, DETAIL_KEYS),
    startedAt: pickStamp(value, STARTED_KEYS),
    updatedAt: pickStamp(value, UPDATED_KEYS),
  };
}

/**
 * Whatever the route answered with, as berths.
 *
 * An answer with no list in it yields none — unlike the P1 band, which renders an unrecognised
 * object field-by-field so the operator can see there is something there. A native session view
 * has no room for that: a row in it is a session, and inventing rows out of an object's keys
 * would put things in the operator's session list that are not sessions. The band remains the
 * place that shows what could not be read; a test pins that difference.
 */
export function toBerths(body: unknown): Berth[] {
  if (Array.isArray(body)) return body.map(berthFor);
  if (isObject(body)) {
    for (const key of LIST_KEYS) {
      const list = body[key];
      if (Array.isArray(list)) return list.map(berthFor);
    }
  }
  return [];
}

/** `<baseUrl>/dashboard/sessions`, with exactly one slash between and no guessing about the rest. */
export function berthsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${BERTHS_ROUTE}`;
}
