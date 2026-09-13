/**
 * The four things pack-lint must fail on, each with a passing fixture beside the failing one.
 *
 * The fixtures are built here rather than kept as files because the interesting part of each is
 * the one field that differs from a good manifest, and a diff of two literals says that better
 * than two files do.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseYamlLite } from '../../../schemas/src/yaml-lite.js';
import { lintManifest, referencesToolName, type PlankSource } from '../src/rules.js';

const schema = JSON.parse(readFileSync(join(__dirname, '../../../schemas/plank.schema.json'), 'utf8')) as unknown;

const GOOD = `plank: mewd.law-plank
face: A6-working
keel: mewd
consumes:
  mcp_tools: []
  mcp_streams: []
affordance_class: render-only
state_policy: cache-only
swap_invariant: install-uninstall
upstream:
  - diagnostics
  - code-actions
terminal: NEVER-DECLARED
schema: 1
`;

/** Source that registers both declared upstream points, so only the field under test differs. */
const SOURCE = `
  vscode.languages.createDiagnosticCollection('law');
  vscode.languages.registerCodeActionsProvider({ language: 'markdown' }, provider);
`;

function lint(manifestText: string, sourceText = SOURCE): ReturnType<typeof lintManifest> {
  const { value, positions } = parseYamlLite(manifestText);
  const plank: PlankSource = {
    manifestPath: 'packages/under-test/plank.yaml',
    manifest: value,
    positions,
    sourceText,
  };
  return lintManifest(plank, schema);
}

const rules = (manifestText: string, sourceText?: string): string[] =>
  lint(manifestText, sourceText).map((f) => f.rule);

describe('a manifest that keeps its promises', () => {
  it('passes', () => {
    expect(lint(GOOD)).toEqual([]);
  });
});

describe('keel', () => {
  it('fails a keel outside the published set', () => {
    const findings = lint(GOOD.replace('keel: mewd', 'keel: someone-elses-boat'));
    expect(findings.map((f) => f.rule)).toContain('plank/keel');
    expect(findings.find((f) => f.rule === 'plank/keel')?.message).toContain('may not invent a keel');
  });

  it('points at the line the keel is on', () => {
    const findings = lint(GOOD.replace('keel: mewd', 'keel: someone-elses-boat'));
    expect(findings.find((f) => f.rule === 'plank/keel')?.line).toBe(3);
  });
});

describe('upstream', () => {
  it('fails an upstream outside the enum', () => {
    expect(rules(GOOD.replace('  - diagnostics', '  - terminal-access'))).toContain('plank/upstream');
  });

  it('fails an upstream the plank never registers', () => {
    expect(rules(GOOD, "vscode.languages.createDiagnosticCollection('law');")).toContain('plank/upstream-unused');
  });
});

describe('terminal', () => {
  it('fails any value other than NEVER-DECLARED', () => {
    const findings = lint(GOOD.replace('terminal: NEVER-DECLARED', 'terminal: integrated'));
    expect(findings.map((f) => f.rule)).toContain('plank/terminal');
    expect(findings.find((f) => f.rule === 'plank/terminal')?.message).toContain('no flag that changes it');
  });

  it('fails a terminal that is merely absent', () => {
    expect(rules(GOOD.replace('terminal: NEVER-DECLARED\n', ''))).toContain('plank/terminal');
  });
});

describe('dead grants', () => {
  it('fails a declared mcp_tool the source never references', () => {
    const withGrant = GOOD.replace('  mcp_tools: []', '  mcp_tools: [propose]');
    const findings = lint(withGrant);
    expect(findings.map((f) => f.rule)).toContain('plank/dead-grant');
    expect(findings.find((f) => f.rule === 'plank/dead-grant')?.message).toContain('a grant it should not hold');
  });

  it('accepts a declared mcp_tool the source does reference', () => {
    const withGrant = GOOD.replace('  mcp_tools: []', '  mcp_tools: [propose]');
    expect(lint(withGrant, `${SOURCE}\nawait client.call('propose', payload);`)).toEqual([]);
  });

  it('fails a declared mcp_stream the source never references', () => {
    expect(rules(GOOD.replace('  mcp_streams: []', '  mcp_streams: [findings]'))).toContain('plank/dead-grant');
  });

  it('does not count a bare word in prose as a reference', () => {
    const withGrant = GOOD.replace('  mcp_tools: []', '  mcp_tools: [propose]');
    expect(rules(withGrant, '// we might propose something here one day')).toContain('plank/dead-grant');
  });
});

/**
 * `session-provider` is the first upstream point in the enum with a marker behind it since P0.
 * A plank may say it provides sessions only if it registers a provider; saying so without one
 * would make the manifest a wish rather than a map.
 */
describe('the session provider', () => {
  const WITH_SESSIONS = GOOD.replace('  - diagnostics\n  - code-actions', '  - session-provider');

  it('accepts a plank that registers one', () => {
    const source = `vscode.authentication.registerAuthenticationProvider('mewd', label, provider);`;
    expect(lint(WITH_SESSIONS, source)).toEqual([]);
  });

  it('fails a plank that declares one and does not', () => {
    const findings = lint(WITH_SESSIONS, '// we will get to the sign-in later');
    expect(findings.map((f) => f.rule)).toContain('plank/upstream-unused');
    expect(findings.find((f) => f.rule === 'plank/upstream-unused')?.message).toContain(
      'registerAuthenticationProvider',
    );
  });
});

describe('referencesToolName', () => {
  it('matches a quoted name in any of the three quote styles', () => {
    expect(referencesToolName(`call('propose')`, 'propose')).toBe(true);
    expect(referencesToolName(`call("propose")`, 'propose')).toBe(true);
    expect(referencesToolName('call(`propose`)', 'propose')).toBe(true);
  });

  it('does not match an unquoted occurrence', () => {
    expect(referencesToolName('// propose', 'propose')).toBe(false);
  });
});

describe('schema conformance', () => {
  it('fails a plank id that is not mewd.<name>', () => {
    expect(rules(GOOD.replace('plank: mewd.law-plank', 'plank: law-plank'))).toContain('schema');
  });

  it('fails an unknown field', () => {
    expect(rules(`${GOOD}telemetry: true\n`)).toContain('schema');
  });

  it('fails a state_policy other than cache-only', () => {
    expect(rules(GOOD.replace('state_policy: cache-only', 'state_policy: durable'))).toContain('schema');
  });

  it('fails a manifest that is not a mapping', () => {
    const findings = lintManifest(
      { manifestPath: 'p/plank.yaml', manifest: ['a'], positions: new Map(), sourceText: '' },
      schema,
    );
    expect(findings[0]?.rule).toBe('manifest/shape');
  });
});
