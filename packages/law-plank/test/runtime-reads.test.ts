/**
 * The promise this plank exists to keep: it reads the open workspace's law, and carries none of it.
 *
 * P4 more than doubled the number of files law-plank reads out of a workspace — three schemas, the
 * tickets, the pathway declarations, the surfaces, the tool manifest, the assignment table. Every
 * one of them is a file that could have been bundled instead, and bundling one would have been
 * easier than not. So the promise is asserted here rather than described in a README:
 *
 *   - no schema is inside this package, or inside anything it ships;
 *   - every workspace path is a path the code *resolves*, not a copy of the file at it;
 *   - nothing in the package carries a trace of a private tree somebody developed against.
 *
 * The last of those is the "no-Mewd-source" assertion. `pack-lint` runs the same scan over the
 * built payload in CI; this runs it over the source, the tests and the fixtures too, because a
 * fixture is exactly where a copied file would end up if one ever were.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const PACKAGE = join(__dirname, '..');
const ROOT = join(PACKAGE, '../..');

const SKIP = new Set(['node_modules', 'dist', 'out', '.vscode-test', 'coverage']);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir).sort()) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(relative(PACKAGE, full).split(sep).join('/'));
  }
  return out;
}

const files = walk(PACKAGE);

/**
 * The workspace paths the plank resolves at runtime, exactly as `extension.ts` spells them.
 *
 * This list is the point of the test rather than an input to it: every entry is a file that
 * belongs to somebody else's workspace, and the assertions below are that each one is named and
 * none is carried.
 */
const WORKSPACE_PATHS = [
  'docs/schema/unit.schema.json',
  'docs/schema/ticket.schema.json',
  'docs/schema/pathway.schema.json',
  'docs/units/*.md',
  'docs/map/tickets/*.md',
  'docs/pathways/*.toml',
  'docs/deps.toml',
  'docs/surfaces.yml',
  'docs/tools.yml',
  'assignment.toml',
];

const extensionSource = readFileSync(join(PACKAGE, 'src/extension.ts'), 'utf8');

describe('the workspace files this plank reads', () => {
  it.each(WORKSPACE_PATHS)('%s is named in extension.ts, so it is resolved rather than assumed', (path) => {
    // `docs/units/*.md` is spelled as a directory and a glob suffix; both halves must be there.
    const [dir, glob] = path.includes('*') ? [path.slice(0, path.lastIndexOf('/')), path.slice(path.lastIndexOf('/'))] : [path, ''];
    expect(extensionSource).toContain(dir);
    if (glob !== '') expect(extensionSource).toContain(glob.slice(glob.indexOf('*')));
  });

  it('reads all of them through the one helper that can fail softly', () => {
    // A workspace that has only some of these files still works. That is only true because every
    // read goes through `readTextIfPresent`, which comes back null rather than throwing.
    expect(extensionSource).toContain('async function readTextIfPresent');
    expect(extensionSource).not.toMatch(/\bfs\.readFileSync\b/);
  });
});

describe('no schema is bundled', () => {
  it('this package carries no .schema.json outside its fixtures', () => {
    const schemas = files.filter((f) => f.endsWith('.schema.json'));
    expect(schemas.every((f) => f.startsWith('test/fixtures/'))).toBe(true);
  });

  it('nothing outside the fixtures is a JSON document with a $schema in it', () => {
    const carried = files.filter((file) => {
      if (!file.endsWith('.json') || file.startsWith('test/')) return false;
      return readFileSync(join(PACKAGE, file), 'utf8').includes('"$schema"');
    });
    expect(carried).toEqual([]);
  });

  it('.vscodeignore keeps the source, the tests and the fixtures out of the .vsix', () => {
    const ignore = readFileSync(join(PACKAGE, '.vscodeignore'), 'utf8');
    expect(ignore).toContain('src/**');
    expect(ignore).toContain('test/**');
  });

  it('the fixtures are the only place this package holds a workspace file at all', () => {
    const held = files.filter((f) => f.endsWith('.toml') || f.endsWith('.yml') || f.endsWith('.yaml'));
    expect(held.filter((f) => !f.startsWith('test/fixtures/') && f !== 'plank.yaml')).toEqual([]);
  });

  // The .vsix itself, when one has been built. pack-lint asserts the same thing over every
  // plank's bundle; this is the one for law-plank, which is the plank that reads the most.
  it('no built .vsix carries a schema, a unit, a ticket, a pathway or a dependency table', () => {
    const vsix = join(ROOT, 'dist/law-plank-0.1.0.vsix');
    if (!existsSync(vsix)) {
      expect(existsSync(join(PACKAGE, 'dist'))).toBe(true);
      return;
    }
    const text = readFileSync(vsix).toString('latin1');
    for (const forbidden of [
      'unit.schema.json',
      'ticket.schema.json',
      'pathway.schema.json',
      'docs/units/',
      'docs/map/tickets/',
      'docs/pathways/',
      'deps.toml',
      'surfaces.yml',
    ]) {
      // Zip entry names are stored uncompressed, so a packaged file's path is findable as text.
      expect(text.includes(`extension/${forbidden}`)).toBe(false);
    }
  });
});

/**
 * The no-Mewd-source assertion.
 *
 * The tokens are built from fragments rather than written out, for the same reason `pack-lint`
 * builds its denylist that way: a literal in this file would match itself the moment anything
 * scanned it, and a public repository should not carry the list of names it is avoiding.
 */
describe('nothing here came from a private tree', () => {
  const tokens = [
    ['fabric', '/'].join(''),
    ['supervisor', '/'].join(''),
    ['work', 'space', '/'].join(''),
    ['tidea', '-', 'fabric'].join(''),
  ];

  const TEXT = new Set(['.ts', '.json', '.md', '.yml', '.yaml', '.toml']);
  const scanned = files.filter((f) => TEXT.has(f.slice(f.lastIndexOf('.'))) && f !== 'test/runtime-reads.test.ts');

  it('has files to scan in the first place, including the fixtures', () => {
    expect(scanned.length).toBeGreaterThan(10);
    expect(scanned.some((f) => f.startsWith('test/fixtures/'))).toBe(true);
  });

  it.each(tokens.map((t) => [t.length] as const))('carries no denylisted token (%i chars)', (length) => {
    const token = tokens.find((t) => t.length === length)!;
    const hits = scanned.filter((file) => readFileSync(join(PACKAGE, file), 'utf8').toLowerCase().includes(token));
    expect(hits).toEqual([]);
  });

  it('names no host, address or home directory in its fixtures', () => {
    for (const file of scanned.filter((f) => f.startsWith('test/fixtures/'))) {
      const text = readFileSync(join(PACKAGE, file), 'utf8');
      expect(text).not.toMatch(/(?<![0-9.])(?:[0-9]{1,3}\.){3}[0-9]{1,3}(?![0-9.])/);
      expect(text).not.toMatch(/\/home\/[A-Za-z0-9._-]+\//);
      expect(text).not.toMatch(/\b[a-z0-9-]+\.(?:lan|local|internal|ts\.net)\b/i);
    }
  });
});
