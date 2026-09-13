/**
 * Turning whatever a served route answered with into rows.
 *
 * This runs in the extension host, before anything is posted to the webview, and that placement
 * is the point. The webview receives rows of plain strings and paints them; it never parses a
 * fabric response, never walks an unknown object, and so never has a reason to grow the sort of
 * code that ends up reaching for `innerHTML`.
 *
 * The shapes understood are the ones a dashboard route plausibly answers with. Anything else
 * becomes a row that says what it was rather than being dropped: a band that silently renders
 * nothing is indistinguishable from a band with nothing to render, and those are very different
 * things to be told.
 */

export interface Row {
  readonly title: string;
  readonly detail: string | null;
  readonly badge: string | null;
}

/** Keys a route might hang its list off, in the order they are looked for. */
const LIST_KEYS = ['items', 'entries', 'rows', 'results', 'data'] as const;

/** Keys that read as the name of a thing. */
const TITLE_KEYS = ['title', 'name', 'label', 'summary', 'subject', 'id'] as const;

/** Keys that read as a note about it. */
const DETAIL_KEYS = ['detail', 'description', 'note', 'why', 'reason', 'path', 'at', 'updated_at'] as const;

/** Keys that read as a one-word state. */
const BADGE_KEYS = ['status', 'state', 'kind', 'severity', 'role', 'count'] as const;

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
    if (found !== null && found !== '') return found;
  }
  return null;
}

function rowFor(value: unknown, index: number): Row {
  const fallbackTitle = `#${index + 1}`;
  if (isObject(value)) {
    const title = pick(value, TITLE_KEYS);
    const detail = pick(value, DETAIL_KEYS);
    return {
      title: title ?? fallbackTitle,
      // An entry none of the known keys fit is still an entry. Naming its fields says more than
      // a numbered row with nothing under it, and is the difference between "there is something
      // here I cannot read" and "there is nothing here".
      detail: detail ?? (title === null ? Object.keys(value).join(', ') || 'no fields' : null),
      badge: pick(value, BADGE_KEYS),
    };
  }
  const flat = scalar(value);
  if (flat !== null) return { title: flat, detail: null, badge: null };
  return { title: fallbackTitle, detail: describeShape(value), badge: null };
}

function describeShape(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `a list of ${value.length}`;
  return typeof value;
}

export function toRows(body: unknown): Row[] {
  if (Array.isArray(body)) return body.map(rowFor);

  if (isObject(body)) {
    for (const key of LIST_KEYS) {
      const list = body[key];
      if (Array.isArray(list)) return list.map(rowFor);
    }
    return Object.entries(body).map(([key, value]) => ({
      title: key,
      detail: scalar(value) ?? describeShape(value),
      badge: null,
    }));
  }

  const flat = scalar(body);
  if (flat !== null) return [{ title: flat, detail: null, badge: null }];
  return [{ title: 'the route answered with nothing this band can show', detail: describeShape(body), badge: null }];
}
