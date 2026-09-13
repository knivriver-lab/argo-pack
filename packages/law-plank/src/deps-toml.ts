/**
 * `docs/deps.toml` — the dependency edges, written down once.
 *
 * A unit's front matter says what it depends on. `deps.toml` says the same thing from the
 * outside, so a reader can see the shape of the graph without opening every document, and so an
 * edge that exists in one place but not the other is visible rather than assumed. C6 is the rule
 * that holds the two in agreement.
 *
 * The reader below covers the shape this file actually has — `[[edge]]` tables with `from` and
 * `to` — and stops at anything more. A TOML feature we do not implement is reported, never
 * skipped, because a silently-ignored edge would make C6 pass for the wrong reason.
 */

export interface DepEdge {
  readonly from: string;
  readonly to: string;
  /** Zero-based line of the `[[edge]]` header this came from. */
  readonly line: number;
}

export interface DepsTable {
  readonly edges: readonly DepEdge[];
  readonly problems: readonly { readonly message: string; readonly line: number }[];
}

const HEADER = /^\[\[\s*edge\s*\]\]$/;
const OTHER_HEADER = /^\[\[?[^\]]*\]?\]$/;
const PAIR = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/;

function unquote(raw: string): string | null {
  const s = raw.trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1);
  return null;
}

function stripComment(line: string): string {
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quote) {
      if (ch === '\\' && quote === '"') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '#') return line.slice(0, i);
  }
  return line;
}

interface Block {
  from?: string;
  to?: string;
  readonly line: number;
}

export function parseDepsToml(text: string): DepsTable {
  const problems: { message: string; line: number }[] = [];
  const blocks: Block[] = [];

  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = stripComment(lines[index]!.replace(/\r$/, '')).trim();
    if (line === '') continue;

    if (HEADER.test(line)) {
      blocks.push({ line: index });
      continue;
    }
    if (OTHER_HEADER.test(line)) {
      problems.push({ message: `only [[edge]] tables are understood here, found ${line}`, line: index });
      continue;
    }

    const m = PAIR.exec(line);
    if (m === null) {
      problems.push({ message: `expected \`key = "value"\`, found ${JSON.stringify(line)}`, line: index });
      continue;
    }
    const key = m[1]!;
    const block = blocks[blocks.length - 1];
    if (block === undefined) {
      problems.push({ message: `\`${key}\` sits outside any [[edge]] table`, line: index });
      continue;
    }
    const value = unquote(m[2]!);
    if (value === null) {
      problems.push({ message: `\`${key}\` must be a quoted string`, line: index });
      continue;
    }
    if (key === 'from') block.from = value;
    else if (key === 'to') block.to = value;
    else problems.push({ message: `unknown key \`${key}\` in [[edge]]`, line: index });
  }

  const edges: DepEdge[] = [];
  for (const block of blocks) {
    if (block.from === undefined || block.to === undefined) {
      problems.push({ message: '[[edge]] needs both `from` and `to`', line: block.line });
      continue;
    }
    edges.push({ from: block.from, to: block.to, line: block.line });
  }

  problems.sort((a, b) => a.line - b.line);
  return { edges, problems };
}

export function hasEdge(deps: DepsTable, from: string, to: string): boolean {
  return deps.edges.some((e) => e.from === from && e.to === to);
}

/** The text to append to `docs/deps.toml` to record one edge. */
export function renderEdge(from: string, to: string): string {
  return `\n[[edge]]\nfrom = ${JSON.stringify(from)}\nto = ${JSON.stringify(to)}\n`;
}
