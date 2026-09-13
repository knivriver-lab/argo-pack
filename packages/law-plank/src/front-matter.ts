/**
 * Pulling the front matter out of a unit document.
 *
 * A unit document is markdown that opens with a `---` fenced YAML block. Everything the law has
 * an opinion about lives in that block; the prose below it is the unit's own business.
 *
 * The parse never throws. A document with no front matter, or with front matter this reader
 * cannot understand, comes back described rather than as an exception — the point of the plank
 * is to say what is wrong with a file, and "I could not read your front matter" is a finding,
 * not a crash.
 */

import { parseYamlLite, YamlLiteError, type Pos } from './yaml-lite.js';

export interface FrontMatterRange {
  /** Zero-based line of the opening `---`. */
  readonly openLine: number;
  /** Zero-based line of the closing `---`. */
  readonly closeLine: number;
  /** Zero-based line of the first line inside the block (may equal `closeLine` when empty). */
  readonly firstContentLine: number;
}

export interface FrontMatter {
  /** The parsed mapping, or `null` when there was nothing readable. */
  readonly value: unknown;
  readonly positions: ReadonlyMap<string, Pos>;
  readonly range: FrontMatterRange | null;
  /** Set when a block was present but could not be read. */
  readonly error?: { readonly message: string; readonly line: number };
}

const FENCE = /^---\s*$/;

export function parseFrontMatter(text: string): FrontMatter {
  const lines = text.split('\n');

  let open = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.replace(/\r$/, '');
    if (line.trim() === '') continue;
    if (FENCE.test(line)) open = i;
    break;
  }
  if (open === -1) {
    return { value: null, positions: new Map(), range: null };
  }

  let close = -1;
  for (let i = open + 1; i < lines.length; i++) {
    if (FENCE.test(lines[i]!.replace(/\r$/, ''))) {
      close = i;
      break;
    }
  }
  if (close === -1) {
    return {
      value: null,
      positions: new Map(),
      range: null,
      error: { message: 'front matter block is never closed — expected a matching `---`', line: open },
    };
  }

  const range: FrontMatterRange = { openLine: open, closeLine: close, firstContentLine: open + 1 };
  const body = lines.slice(open + 1, close).join('\n');

  if (body.trim() === '') {
    return { value: {}, positions: new Map(), range };
  }

  try {
    const { value, positions } = parseYamlLite(body, open + 1);
    return { value, positions, range };
  } catch (err) {
    const line = err instanceof YamlLiteError ? err.line : open;
    return {
      value: null,
      positions: new Map(),
      range,
      error: { message: err instanceof Error ? err.message : String(err), line },
    };
  }
}
