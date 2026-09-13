/**
 * The "nothing was copied in" guard.
 *
 * A plank reads the open workspace's files at runtime and carries none of them. That claim is
 * only worth something if something checks it, so: the unit tests below exercise the scanner,
 * and the last block runs it over the payload this repository actually built.
 *
 * The denylisted tokens are assembled from fragments here for the same reason they are in the
 * guard itself — a literal would match itself the moment the scanner reached this file.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ALLOWED_WORKSPACE_PATHS,
  denylistTokens,
  listVsixEntries,
  packagedWorkspaceArtefacts,
  scanBundleText,
} from '../src/bundle-guard.js';
import { lintTree, walk } from '../src/lint.js';

const ROOT = join(__dirname, '../../..');

const FABRIC = ['fab', 'ric', '/'].join('');
const SUPERVISOR = ['super', 'visor', '/'].join('');
const WORKSPACE = ['work', 'space', '/'].join('');
const TIDEA_FABRIC = ['tidea', '-', 'fab', 'ric'].join('');

describe('denylistTokens', () => {
  it('covers the four built-in tokens', () => {
    expect(denylistTokens({})).toEqual([FABRIC, SUPERVISOR, WORKSPACE, TIDEA_FABRIC]);
  });

  it('takes extra terms from a private environment', () => {
    expect(denylistTokens({ PACK_LINT_DENY: 'alpha, beta' })).toContain('alpha');
  });
});

describe('scanBundleText', () => {
  const tokens = denylistTokens({});

  it('says nothing about a clean payload', () => {
    expect(scanBundleText('const UNITS_DIR = "docs/units";\n', tokens)).toEqual([]);
  });

  it('catches each denylisted token', () => {
    for (const token of tokens) {
      expect(scanBundleText(`const p = "${token}thing";`, tokens).map((h) => h.token)).toContain(token);
    }
  });

  it('is case-insensitive', () => {
    expect(scanBundleText(`const p = "${FABRIC.toUpperCase()}";`, tokens)).toHaveLength(1);
  });

  it('reports line and column so the finding can be looked at', () => {
    const hit = scanBundleText(`ok\nconst p = "${SUPERVISOR}x";\n`, tokens)[0];
    expect(hit?.line).toBe(2);
    expect(hit?.column).toBe(12);
  });

  // The two paths law-plank resolves out of the open workspace. Naming them is the point;
  // carrying their contents is what is forbidden, and that is checked separately.
  it('tolerates a token only when it sits inside one of the two allowed workspace paths', () => {
    for (const allowed of ALLOWED_WORKSPACE_PATHS) {
      expect(scanBundleText(`const p = ${JSON.stringify(allowed)};`, [...tokens, 'docs/'])).toEqual([]);
    }
  });

  it('still catches the same token just outside an allowed path', () => {
    expect(scanBundleText(`"docs/units/" + "${WORKSPACE}x"`, tokens)).toHaveLength(1);
  });
});

describe('packagedWorkspaceArtefacts', () => {
  it('flags a schema, a unit document or a dependency table inside a vsix', () => {
    expect(
      packagedWorkspaceArtefacts([
        'extension/dist/extension.js',
        'extension/docs/schema/unit.schema.json',
        'extension/deps.toml',
        'extension/plank.yaml',
      ]),
    ).toEqual(['extension/docs/schema/unit.schema.json', 'extension/deps.toml']);
  });

  it('leaves an ordinary bundle alone', () => {
    expect(packagedWorkspaceArtefacts(['extension/dist/extension.js', 'extension.vsixmanifest'])).toEqual([]);
  });
});

describe('the payload this repository built', () => {
  const planks = ['law-plank', 'hello-band', 'fabric-auth', 'served-bands'];

  it.each(planks)('%s has been compiled', (plank) => {
    expect(existsSync(join(ROOT, 'packages', plank, 'dist', 'extension.js'))).toBe(true);
  });

  it.each(planks)('%s carries no denylisted token', (plank) => {
    const tokens = denylistTokens({});
    const hits: string[] = [];
    for (const sub of ['dist', 'media']) {
      const dir = join(ROOT, 'packages', plank, sub);
      if (!existsSync(dir)) continue;
      for (const file of walk(dir)) {
        if (file.endsWith('.map')) continue;
        for (const hit of scanBundleText(readFileSync(join(dir, file), 'utf8'), tokens)) {
          hits.push(`${plank}/${sub}/${file}:${hit.line} ${hit.context}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it.each(planks)('%s bundles no schema, unit document or dependency table', (plank) => {
    const vsix = join(ROOT, 'dist', `${plank}-0.1.0.vsix`);
    if (!existsSync(vsix)) {
      // `npm run build` has not run in this checkout; the CI job runs it before this suite.
      expect(existsSync(join(ROOT, 'packages', plank, 'dist'))).toBe(true);
      return;
    }
    expect(packagedWorkspaceArtefacts(listVsixEntries(vsix))).toEqual([]);
  });

  it('passes the bundle check as the CI job runs it', () => {
    expect(lintTree(ROOT, { only: 'bundle' }).findings).toEqual([]);
  });

  /**
   * The sign-in is the plank most likely to acquire a copy of something, because it is the one
   * that talks to a fabric. It holds a client id from settings and a token in SecretStorage,
   * and neither of them — nor any host — is in what it ships.
   */
  it('fabric-auth ships no host, no client id and no token', () => {
    const dir = join(ROOT, 'packages', 'fabric-auth', 'dist');
    if (!existsSync(dir)) return;
    for (const file of walk(dir)) {
      if (!file.endsWith('.js')) continue;
      const text = readFileSync(join(dir, file), 'utf8');
      expect(text).not.toMatch(/\bhttps?:\/\/(?!www\.w3\.org)/);
      expect(text).not.toMatch(/\beyJ[A-Za-z0-9_-]{8,}\./);
      expect(text).not.toMatch(/client_secret/);
    }
  });
});
