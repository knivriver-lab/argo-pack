/**
 * The "nothing was copied in" proof, for this plank specifically.
 *
 * `argo-pack` is public and the fabric it reads is not. This plank was built against the mock
 * payload in `mock-fabric.ts` and the vendored proposed-API declaration, and against nothing
 * else: no private checkout was read, no live host was called, and the route is known from the
 * P1 band's own table rather than from anything that serves it.
 *
 * That is a claim about how the work was done, and a claim about process is worth exactly what
 * checks it. What can be checked is the residue such a build would leave — a denylisted path
 * fragment, an origin, an address, a home directory — so this file looks for all of them across
 * every file the package carries, using the same rule sets `pack-lint` runs over the tree.
 *
 * The terms are never written down here. They are asked for from the module that assembles them
 * from fragments, for the reason that module explains: a public repository must not carry the
 * list of names it is trying not to mention.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { denylistTokens, scanBundleText } from '../../pack-lint/src/bundle-guard.js';
import { scanPrivateRefs } from '../../pack-lint/src/private-refs.js';

const PACKAGE_ROOT = join(__dirname, '..');
const SKIP = new Set(['node_modules', 'dist', 'tsconfig.tsbuildinfo']);

function filesUnder(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir).sort()) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) filesUnder(full, out);
    else out.push(full);
  }
  return out;
}

const files = filesUnder(PACKAGE_ROOT);
const rel = (path: string): string => relative(PACKAGE_ROOT, path).split(sep).join('/');

describe('the package this plank ships', () => {
  it('has files to check, so an empty sweep cannot pass by accident', () => {
    expect(files.length).toBeGreaterThan(8);
    expect(files.map(rel)).toContain('src/extension.ts');
    expect(files.map(rel)).toContain('plank.yaml');
  });

  it('carries no trace of a private tree', () => {
    const tokens = denylistTokens({});
    expect(tokens.length).toBeGreaterThan(0);

    const offenders = files.flatMap((file) =>
      scanBundleText(readFileSync(file, 'utf8'), tokens).map((hit) => `${rel(file)}:${hit.line}`),
    );
    expect(offenders).toEqual([]);
  });

  it('names no host, no address and no home directory', () => {
    const offenders = files.flatMap((file) =>
      scanPrivateRefs(readFileSync(file, 'utf8'), []).map(
        (hit) => `${rel(file)}:${hit.line} ${hit.ruleId}`,
      ),
    );
    expect(offenders).toEqual([]);
  });
});

describe('the origins this package contains', () => {
  /**
   * Two, and only two kinds. Anything under the RFC 2606 reserved `.test` TLD, which resolves
   * nowhere and is obviously fictional, and this repository's own public URL in `package.json`.
   * A third kind would be somebody's fabric.
   */
  const RESERVED = /^https?:\/\/(?:[A-Za-z0-9-]+\.)*test$/;
  const OWN_REPO = 'https://github.com';

  it('are reserved names and this repository’s own, and nothing else', () => {
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      const origins = [...text.matchAll(/https?:\/\/[A-Za-z0-9._-]+/g)].map((m) => m[0]);
      const foreign = origins.filter((o) => !RESERVED.test(o) && o !== OWN_REPO);
      expect({ file: rel(file), foreign }).toEqual({ file: rel(file), foreign: [] });
    }
  });

  it('uses a reserved name for the mock fabric, so no test can reach anything', () => {
    const fixtures = readFileSync(join(PACKAGE_ROOT, 'test', 'mock-fabric.ts'), 'utf8');
    expect(fixtures).toContain("'https://example.test'");
    expect(RESERVED.test('https://example.test')).toBe(true);

    // Assembled rather than written out, for the same reason `bundle-guard` assembles its
    // denylist: a literal here would be an origin in this file, and the sweep above reads this
    // file too. A check that cannot survive being run over its own source is not a check.
    const notReserved = ['https://', 'somewhere', '.', 'example', '.', 'org'].join('');
    expect(RESERVED.test(notReserved)).toBe(false);
  });

  it('does not appear in src/ at all — this plank ships no default fabric', () => {
    const source = files.filter((f) => rel(f).startsWith('src/'));
    expect(source.length).toBeGreaterThan(4);
    for (const file of source) {
      expect(readFileSync(file, 'utf8')).not.toMatch(/https?:\/\//);
    }
  });
});
