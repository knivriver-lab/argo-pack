/**
 * A deliberately small TOML reader, for the pathway declarations and the assignment table.
 *
 * It covers exactly the shapes those files use — bare `key = value` pairs, `[table]` headers,
 * `[[table]]` arrays of tables, basic and literal strings, integers, floats, booleans, and
 * single-line arrays of those — and nothing else. Dotted keys, inline tables, multi-line arrays,
 * multi-line strings and dates are not implemented.
 *
 * A construct it does not implement is **reported, never skipped**. A pathway declaration is a
 * promise about where a person gets a say and what an agent may do; a reader that quietly
 * ignored half of one would make every check downstream pass for the wrong reason. The same
 * reasoning holds in `deps-toml.ts`, which reads a narrower file and says so there too.
 *
 * Every value carries the line and column it came from, because the reason to parse a
 * declaration at all is to be able to point at the part of it that is wrong.
 */

import type { Pos } from './yaml-lite.js';

export interface TomlProblem {
  readonly message: string;
  /** Zero-based. */
  readonly line: number;
}

export interface ParsedToml {
  readonly value: Record<string, unknown>;
  /** Keyed by dotted path — `stages.0.verbs.1`, `approvals.0`, `id`. */
  readonly positions: ReadonlyMap<string, Pos>;
  readonly problems: readonly TomlProblem[];
}

const ARRAY_TABLE = /^\[\[(.*)\]\]$/;
const TABLE = /^\[(.*)\]$/;
const PAIR = /^([A-Za-z0-9_-]+)[ \t]*=[ \t]*(.*)$/;
const BARE_NAME = /^[A-Za-z0-9_-]+$/;
const INTEGER = /^[+-]?(?:0|[1-9](?:_?[0-9])*)$/;
const FLOAT = /^[+-]?(?:0|[1-9](?:_?[0-9])*)\.[0-9](?:_?[0-9])*$/;

/** Strip a trailing `#` comment that is not inside a quoted string. */
function stripComment(line: string): string {
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quote !== null) {
      if (ch === '\\' && quote === '"') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '#') return line.slice(0, i);
  }
  return line;
}

interface Part {
  readonly text: string;
  /** Column of the first character of `text` within the original line. */
  readonly column: number;
}

/** Split an array body on commas that are not nested or quoted, keeping each part's column. */
function splitItems(body: string, column: number): Part[] | null {
  const parts: Part[] = [];
  let depth = 0;
  let quote: '"' | "'" | null = null;
  let start = 0;

  const push = (from: number, to: number): void => {
    const slice = body.slice(from, to);
    const lead = slice.length - slice.trimStart().length;
    const text = slice.trim();
    if (text !== '') parts.push({ text, column: column + from + lead });
  };

  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (quote !== null) {
      if (ch === '\\' && quote === '"') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') depth--;
    else if (ch === ',' && depth === 0) {
      push(start, i);
      start = i + 1;
    }
  }
  if (quote !== null || depth !== 0) return null;
  push(start, body.length);
  return parts;
}

function unescapeBasic(inner: string): string {
  return inner
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '\r')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

interface Context {
  readonly line: number;
  readonly positions: Map<string, Pos>;
  readonly problems: TomlProblem[];
}

function parseValue(part: Part, path: string, ctx: Context): unknown {
  const { text, column } = part;
  const fail = (message: string): null => {
    ctx.problems.push({ message, line: ctx.line });
    return null;
  };

  if (text === '') return fail('a key was given no value');

  if (text.startsWith('[')) {
    if (!text.endsWith(']')) {
      return fail('an array has to be closed on the line it opens — a multi-line array is not read here');
    }
    const items = splitItems(text.slice(1, -1), column + 1);
    if (items === null) return fail(`the array ${JSON.stringify(text)} is not balanced`);
    return items.map((item, index) => {
      const childPath = `${path}.${index}`;
      ctx.positions.set(childPath, {
        line: ctx.line,
        col: item.column,
        endCol: item.column + item.text.length,
      });
      return parseValue(item, childPath, ctx);
    });
  }

  if (text.startsWith('{')) {
    return fail('an inline table is not read here — write it as a [table] or a [[table]]');
  }

  if (text.startsWith('"')) {
    if (text.length < 2 || !text.endsWith('"')) return fail('a double-quoted string is never closed');
    if (text.startsWith('"""')) return fail('a multi-line string is not read here');
    return unescapeBasic(text.slice(1, -1));
  }

  if (text.startsWith("'")) {
    if (text.length < 2 || !text.endsWith("'")) return fail('a single-quoted string is never closed');
    if (text.startsWith("'''")) return fail('a multi-line string is not read here');
    return text.slice(1, -1);
  }

  if (text === 'true') return true;
  if (text === 'false') return false;
  if (INTEGER.test(text)) return Number(text.replace(/_/g, ''));
  if (FLOAT.test(text)) return Number(text.replace(/_/g, ''));

  return fail(
    `${JSON.stringify(text)} is not a value this reader understands — it covers strings, integers, floats, booleans and single-line arrays of those`,
  );
}

export function parseTomlLite(text: string): ParsedToml {
  const positions = new Map<string, Pos>();
  const problems: TomlProblem[] = [];
  const root: Record<string, unknown> = {};

  let current = root;
  let currentPath = '';
  const definedTables = new Set<string>();

  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index]!.replace(/\r$/, '');
    const body = stripComment(raw);
    const trimmed = body.trim();
    if (trimmed === '') continue;

    const indent = body.length - body.trimStart().length;

    const arrayTable = ARRAY_TABLE.exec(trimmed);
    if (arrayTable !== null) {
      const name = arrayTable[1]!.trim();
      if (!BARE_NAME.test(name)) {
        problems.push({ message: `only a bare [[name]] array of tables is read here, found ${trimmed}`, line: index });
        current = {};
        currentPath = '';
        continue;
      }
      const existing = root[name];
      if (existing !== undefined && !Array.isArray(existing)) {
        problems.push({ message: `\`${name}\` was already set to something other than an array of tables`, line: index });
      }
      const list: unknown[] = Array.isArray(existing) ? existing : [];
      const table: Record<string, unknown> = {};
      list.push(table);
      root[name] = list;
      current = table;
      currentPath = `${name}.${list.length - 1}`;
      positions.set(currentPath, { line: index, col: indent, endCol: indent + trimmed.length });
      continue;
    }

    const table = TABLE.exec(trimmed);
    if (table !== null) {
      const name = table[1]!.trim();
      if (!BARE_NAME.test(name)) {
        problems.push({ message: `only a bare [name] table is read here, found ${trimmed}`, line: index });
        current = {};
        currentPath = '';
        continue;
      }
      if (definedTables.has(name) || name in root) {
        problems.push({ message: `\`${name}\` is defined more than once`, line: index });
      }
      const fresh: Record<string, unknown> = {};
      root[name] = fresh;
      definedTables.add(name);
      current = fresh;
      currentPath = name;
      positions.set(name, { line: index, col: indent, endCol: indent + trimmed.length });
      continue;
    }

    const pair = PAIR.exec(trimmed);
    if (pair === null) {
      problems.push({
        message: `expected \`key = value\`, a [table] or a [[table]], found ${JSON.stringify(trimmed)}`,
        line: index,
      });
      continue;
    }

    const key = pair[1]!;
    const rest = pair[2]!;
    const path = currentPath === '' ? key : `${currentPath}.${key}`;
    const keyColumn = indent;
    positions.set(path, { line: index, col: keyColumn, endCol: keyColumn + key.length });

    if (key in current) {
      problems.push({ message: `\`${key}\` is set more than once in the same table`, line: index });
    }
    const ctx: Context = { line: index, positions, problems };
    current[key] = parseValue({ text: rest.trimEnd(), column: indent + (trimmed.length - rest.length) }, path, ctx);
  }

  problems.sort((a, b) => a.line - b.line);
  return { value: root, positions, problems };
}
