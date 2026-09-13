/**
 * A deliberately small YAML reader.
 *
 * It covers exactly what this pack's own files use — block maps, block sequences, empty flow
 * collections, simple flow sequences, quoted and plain scalars, comments and document markers —
 * and nothing else. Anchors, aliases, tags, multi-line scalars and complex keys are not YAML we
 * are willing to read out of a workspace, so they are not implemented; a file that needs them is
 * reported as an error rather than guessed at.
 *
 * Every value carries the line it came from, because the reason to parse a manifest at all is to
 * be able to point at the line that is wrong.
 *
 * This file exists twice: here, and verbatim at `packages/law-plank/src/yaml-lite.ts`. An
 * extension bundle has to be self-contained — it cannot reach into a workspace package at
 * runtime — so the copy is deliberate. `test/duplication.test.ts` asserts the two are
 * byte-identical, which turns a copy that could drift into one that cannot.
 */

export interface Pos {
  /** Zero-based line in the original text. */
  readonly line: number;
  /** Zero-based column of the first character of the token. */
  readonly col: number;
  /** Zero-based column one past the last character of the token. */
  readonly endCol: number;
}

export interface ParsedYaml {
  readonly value: unknown;
  /**
   * Keyed by JSON-pointer-ish dotted path — `consumes.mcp_tools.0`, `deps.2`, `` for the root.
   */
  readonly positions: ReadonlyMap<string, Pos>;
}

export class YamlLiteError extends Error {
  readonly line: number;
  constructor(message: string, line: number) {
    super(message);
    this.name = 'YamlLiteError';
    this.line = line;
  }
}

interface Entry {
  readonly indent: number;
  readonly text: string;
  readonly line: number;
  /** Column at which `text` begins on the original line. */
  readonly col: number;
}

const KEY_RE = /^(?:"((?:[^"\\]|\\.)*)"|'((?:[^']|'')*)'|([A-Za-z0-9_][A-Za-z0-9_.\-/]*))\s*:(?:\s|$)/;

/** Strip a trailing `#` comment that is not inside a quoted scalar. */
function stripComment(line: string): string {
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quote) {
      if (ch === '\\' && quote === '"') {
        i++;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '#' && (i === 0 || line[i - 1] === ' ' || line[i - 1] === '\t')) {
      return line.slice(0, i);
    }
  }
  return line;
}

function scan(text: string, lineOffset: number): Entry[] {
  const entries: Entry[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!.replace(/\r$/, '');
    if (raw.includes('\t')) {
      // Tabs cannot be used for indentation in YAML and silently ruin alignment elsewhere.
      const before = raw.slice(0, raw.indexOf('\t'));
      if (before.trim() === '') {
        throw new YamlLiteError('tab used for indentation', i + lineOffset);
      }
    }
    const body = stripComment(raw);
    const trimmed = body.trim();
    if (trimmed === '' || trimmed === '---' || trimmed === '...') continue;
    const col = body.length - body.trimStart().length;
    entries.push({ indent: col, text: body.trimEnd().slice(col), line: i + lineOffset, col });
  }
  return entries;
}

/** Split a flow collection body on commas that are not nested or quoted. */
function splitFlow(body: string, line: number): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: '"' | "'" | null = null;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (quote) {
      if (ch === '\\' && quote === '"') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  if (quote !== null) throw new YamlLiteError('unterminated quoted scalar', line);
  if (depth !== 0) throw new YamlLiteError('unbalanced flow collection', line);
  const tail = body.slice(start);
  if (tail.trim() !== '' || parts.length > 0) parts.push(tail);
  return parts;
}

function unquote(raw: string, line: number): string {
  const s = raw.trim();
  if (s.startsWith('"')) {
    if (!s.endsWith('"') || s.length < 2) throw new YamlLiteError('unterminated double-quoted scalar', line);
    return s
      .slice(1, -1)
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
  if (s.startsWith("'")) {
    if (!s.endsWith("'") || s.length < 2) throw new YamlLiteError('unterminated single-quoted scalar', line);
    return s.slice(1, -1).replace(/''/g, "'");
  }
  return s;
}

function parseScalar(raw: string, line: number, path: string, positions: Map<string, Pos>): unknown {
  const s = raw.trim();
  if (s === '' || s === '~' || s === 'null' || s === 'Null' || s === 'NULL') return null;
  if (s.startsWith('[')) {
    if (!s.endsWith(']')) throw new YamlLiteError('unterminated flow sequence', line);
    return splitFlow(s.slice(1, -1), line).map((part, idx) =>
      parseScalar(part, line, path === '' ? String(idx) : `${path}.${idx}`, positions),
    );
  }
  if (s.startsWith('{')) {
    if (!s.endsWith('}')) throw new YamlLiteError('unterminated flow mapping', line);
    const out: Record<string, unknown> = {};
    for (const part of splitFlow(s.slice(1, -1), line)) {
      if (part.trim() === '') continue;
      const colon = part.indexOf(':');
      if (colon === -1) throw new YamlLiteError('flow mapping entry without a value', line);
      const key = unquote(part.slice(0, colon), line);
      const child = path === '' ? key : `${path}.${key}`;
      positions.set(child, { line, col: 0, endCol: 0 });
      out[key] = parseScalar(part.slice(colon + 1), line, child, positions);
    }
    return out;
  }
  if (s.startsWith('"') || s.startsWith("'")) return unquote(s, line);
  if (s === 'true' || s === 'True' || s === 'TRUE') return true;
  if (s === 'false' || s === 'False' || s === 'FALSE') return false;
  if (/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][-+]?[0-9]+)?$/.test(s)) return Number(s);
  return s;
}

function parseBlock(
  entries: Entry[],
  start: number,
  indent: number,
  path: string,
  positions: Map<string, Pos>,
): [unknown, number] {
  const first = entries[start];
  if (first === undefined) return [null, start];

  if (first.text === '-' || first.text.startsWith('- ')) {
    const seq: unknown[] = [];
    let i = start;
    while (i < entries.length) {
      const e = entries[i]!;
      if (e.indent !== indent) break;
      if (e.text !== '-' && !e.text.startsWith('- ')) break;
      const childPath = path === '' ? String(seq.length) : `${path}.${seq.length}`;
      const rest = e.text === '-' ? '' : e.text.slice(2);
      positions.set(childPath, { line: e.line, col: e.col, endCol: e.col + e.text.length });
      if (rest.trim() === '') {
        const next = entries[i + 1];
        if (next !== undefined && next.indent > indent) {
          const [value, consumed] = parseBlock(entries, i + 1, next.indent, childPath, positions);
          seq.push(value);
          i = consumed;
          continue;
        }
        seq.push(null);
        i++;
        continue;
      }
      if (KEY_RE.test(rest)) {
        // `- key: value` — an inline map opening a block item.
        const inner: Entry[] = [{ indent: 0, text: rest, line: e.line, col: e.col + 2 }];
        let j = i + 1;
        while (j < entries.length && entries[j]!.indent > indent) {
          const n = entries[j]!;
          inner.push({ indent: n.indent - indent - 2, text: n.text, line: n.line, col: n.col });
          j++;
        }
        const [value, consumed] = parseBlock(inner, 0, 0, childPath, positions);
        if (consumed !== inner.length) {
          throw new YamlLiteError('unsupported YAML structure in sequence item', e.line);
        }
        seq.push(value);
        i = j;
        continue;
      }
      seq.push(parseScalar(rest, e.line, childPath, positions));
      i++;
    }
    return [seq, i];
  }

  const map: Record<string, unknown> = {};
  let i = start;
  while (i < entries.length) {
    const e = entries[i]!;
    if (e.indent !== indent) break;
    const m = KEY_RE.exec(e.text);
    if (m === null) {
      if (e.indent === indent && i === start) {
        throw new YamlLiteError(`expected 'key: value', found ${JSON.stringify(e.text)}`, e.line);
      }
      break;
    }
    const key = m[1] !== undefined ? m[1].replace(/\\"/g, '"') : m[2] !== undefined ? m[2].replace(/''/g, "'") : m[3]!;
    const childPath = path === '' ? key : `${path}.${key}`;
    positions.set(childPath, { line: e.line, col: e.col, endCol: e.col + m[0].replace(/\s+$/, '').length });
    const rest = e.text.slice(m[0].length);
    if (rest.trim() !== '') {
      map[key] = parseScalar(rest, e.line, childPath, positions);
      i++;
      continue;
    }
    const next = entries[i + 1];
    if (next !== undefined && (next.indent > indent || (next.indent === indent && next.text.startsWith('-')))) {
      const childIndent = next.indent;
      if (childIndent < indent) throw new YamlLiteError('inconsistent indentation', next.line);
      const [value, consumed] = parseBlock(entries, i + 1, childIndent, childPath, positions);
      map[key] = value;
      i = consumed;
      continue;
    }
    map[key] = null;
    i++;
  }
  return [map, i];
}

export function parseYamlLite(text: string, lineOffset = 0): ParsedYaml {
  const positions = new Map<string, Pos>();
  const entries = scan(text, lineOffset);
  if (entries.length === 0) return { value: null, positions };
  const baseIndent = entries[0]!.indent;
  const [value, consumed] = parseBlock(entries, 0, baseIndent, '', positions);
  if (consumed !== entries.length) {
    const stuck = entries[consumed]!;
    throw new YamlLiteError(`unsupported YAML structure: ${JSON.stringify(stuck.text)}`, stuck.line);
  }
  return { value, positions };
}
