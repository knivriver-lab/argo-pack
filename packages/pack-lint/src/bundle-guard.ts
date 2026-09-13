/**
 * The "nothing was copied in" guard.
 *
 * A plank reads the open workspace's files at runtime. It must never carry a copy of them, and
 * it must never carry a trace of the private tree a contributor happened to develop against.
 * This check reads the compiled payload — the exact files that go into the `.vsix` — and fails
 * if any denylisted token survives into it.
 *
 * The denylist is assembled from fragments rather than written out as literals. Two reasons,
 * both practical: a literal here would match itself the moment the guard scans its own compiled
 * output, and a public repository should not carry the list of names it is trying not to
 * mention. Additional terms come from `PACK_LINT_DENY` in a private environment.
 *
 * Exactly two workspace paths are allowed to appear in a bundle. They are the files `law-plank`
 * resolves out of the open workspace at runtime, so naming them is the whole point; carrying
 * their *contents* is what is forbidden, and `assertNoPackagedSchemas` checks that separately by
 * reading the `.vsix` entry names.
 */

import { readFileSync } from 'node:fs';

/** The two workspace paths a bundle may name. A denylisted token is tolerated only inside one. */
export const ALLOWED_WORKSPACE_PATHS: readonly string[] = ['docs/schema/unit.schema.json', 'docs/units/'];

/** Built from fragments so the guard does not trip over its own compiled source. */
export function denylistTokens(env: NodeJS.ProcessEnv = process.env): string[] {
  const built = [
    ['fabric', '/'].join(''),
    ['supervisor', '/'].join(''),
    ['work', 'space', '/'].join(''),
    ['tidea', '-', 'fabric'].join(''),
  ];
  const extra = (env['PACK_LINT_DENY'] ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  return [...built, ...extra];
}

export interface BundleHit {
  readonly token: string;
  readonly line: number;
  readonly column: number;
  readonly context: string;
}

/** True when the occurrence at `index` lies wholly inside one of the allowed workspace paths. */
function insideAllowedPath(text: string, index: number, length: number): boolean {
  return ALLOWED_WORKSPACE_PATHS.some((allowed) => {
    let from = 0;
    for (;;) {
      const at = text.indexOf(allowed, from);
      if (at === -1) return false;
      if (at <= index && index + length <= at + allowed.length) return true;
      from = at + 1;
    }
  });
}

export function scanBundleText(text: string, tokens: readonly string[]): BundleHit[] {
  const hits: BundleHit[] = [];
  for (const token of tokens) {
    const haystack = text.toLowerCase();
    const needle = token.toLowerCase();
    let from = 0;
    for (;;) {
      const at = haystack.indexOf(needle, from);
      if (at === -1) break;
      from = at + needle.length;
      if (insideAllowedPath(text, at, token.length)) continue;
      const before = text.slice(0, at);
      const line = before.split('\n').length;
      const column = at - (before.lastIndexOf('\n') + 1) + 1;
      hits.push({
        token,
        line,
        column,
        context: text.slice(Math.max(0, at - 30), at + token.length + 30).replace(/\n/g, '\\n'),
      });
    }
  }
  return hits.sort((a, b) => a.line - b.line || a.column - b.column);
}

/**
 * Entry names from a zip central directory. Names are stored uncompressed, so a `.vsix` can be
 * listed without pulling in an archive library.
 */
export function listVsixEntries(vsixPath: string): string[] {
  const buf = readFileSync(vsixPath);
  const EOCD = 0x06054b50;
  const CDFH = 0x02014b50;

  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 0xffff; i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error(`${vsixPath}: no zip end-of-central-directory record`);

  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const names: string[] = [];
  for (let n = 0; n < count; n++) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== CDFH) {
      throw new Error(`${vsixPath}: malformed central directory at ${offset}`);
    }
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    names.push(buf.toString('utf8', offset + 46, offset + 46 + nameLen));
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

/** No `.vsix` may package a schema or a unit document. Those belong to the open workspace. */
export function packagedWorkspaceArtefacts(entries: readonly string[]): string[] {
  return entries.filter(
    (e) => /(^|\/)[^/]*\.schema\.json$/i.test(e) || /(^|\/)docs\/(units|schema)\//i.test(e) || /(^|\/)deps\.toml$/i.test(e),
  );
}
