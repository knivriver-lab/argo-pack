/**
 * The manifests this repository actually ships.
 *
 * `rules.test.ts` checks the rules against fixtures; this checks the rules against the pack. The
 * two are different tests: a rule can be right about a fixture and wrong about the tree, and the
 * grant `law-plank` now holds is exactly the sort of claim that is only worth anything if
 * somebody checks it against the plank's own source rather than against a literal.
 */

import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { collectPlanks, lintTree } from '../src/lint.js';
import { referencesToolName } from '../src/rules.js';

const ROOT = join(__dirname, '../../..');

const planks = collectPlanks(ROOT);
const manifestOf = (name: string): Record<string, unknown> =>
  planks.find((p) => p.manifestPath === `packages/${name}/plank.yaml`)?.manifest as Record<string, unknown>;

describe('every manifest in the pack', () => {
  it('passes the manifest check', () => {
    expect(lintTree(ROOT, { only: 'manifests' }).findings).toEqual([]);
  });

  it('covers all four planks', () => {
    expect(planks.map((p) => p.manifestPath).sort()).toEqual([
      'packages/fabric-auth/plank.yaml',
      'packages/hello-band/plank.yaml',
      'packages/law-plank/plank.yaml',
      'packages/served-bands/plank.yaml',
    ]);
  });

  it('declares no terminal, anywhere, under any name', () => {
    for (const plank of planks) {
      expect((plank.manifest as Record<string, unknown>)['terminal']).toBe('NEVER-DECLARED');
    }
  });

  it('floats on the one published keel', () => {
    for (const plank of planks) {
      expect((plank.manifest as Record<string, unknown>)['keel']).toBe('mewd');
    }
  });
});

/**
 * The first MCP grant in the pack, and the only one.
 *
 * It is held by `law-plank` and by nothing else. The bands render; they do not reach.
 */
describe('the propose grant', () => {
  it('is declared by law-plank', () => {
    expect(manifestOf('law-plank')['consumes']).toEqual({ mcp_tools: ['propose'], mcp_streams: [] });
  });

  it('is referenced by law-plank’s own source, so it is a live grant rather than a dead one', () => {
    const source = planks.find((p) => p.manifestPath === 'packages/law-plank/plank.yaml')?.sourceText ?? '';
    expect(referencesToolName(source, 'propose')).toBe(true);
  });

  it('makes law-plank the one plank that surfaces an effect', () => {
    expect(manifestOf('law-plank')['affordance_class']).toBe('effect-surfacing');
  });

  it('is the only MCP grant in the pack', () => {
    const granted = planks.flatMap((plank) => {
      const consumes = (plank.manifest as Record<string, unknown>)['consumes'] as Record<string, unknown>;
      return [...(consumes['mcp_tools'] as string[]), ...(consumes['mcp_streams'] as string[])];
    });
    expect(granted).toEqual(['propose']);
  });
});

describe('the bands', () => {
  const bands = manifestOf('served-bands');

  it('render, and reach for nothing', () => {
    expect(bands['affordance_class']).toBe('render-only');
    expect(bands['consumes']).toEqual({ mcp_tools: [], mcp_streams: [] });
  });

  it('register no extension point from the enum — a webview view is not one of them', () => {
    expect(bands['upstream']).toEqual([]);
  });
});

describe('the sign-in', () => {
  const auth = manifestOf('fabric-auth');

  it('is the one plank that provides a session', () => {
    expect(auth['upstream']).toEqual(['session-provider']);
    for (const plank of planks) {
      if (plank.manifestPath === 'packages/fabric-auth/plank.yaml') continue;
      expect((plank.manifest as Record<string, unknown>)['upstream']).not.toContain('session-provider');
    }
  });

  it('holds no MCP grant of its own', () => {
    expect(auth['consumes']).toEqual({ mcp_tools: [], mcp_streams: [] });
  });
});
