/**
 * The session-mirror rules, with the failing fixture beside the passing one.
 *
 * The point of this file is the mock effect command: a plank that mirrors the fabric's sessions
 * into the editor's native session view and then contributes "Stop session" must fail the lint.
 * A rule nobody has watched fail is a comment, so the rejection is asserted here, on a manifest
 * and a `package.json` built for the purpose.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseYamlLite } from '../../../schemas/src/yaml-lite.js';
import { lintManifest, type PlankSource } from '../src/rules.js';
import {
  EFFECT_VERBS,
  checkSessionMirror,
  contributedCommands,
  isEffectCommand,
  registeredCommands,
  registersSessionItems,
  scanWriteMethods,
  words,
} from '../src/session-mirror-guard.js';

const schema = JSON.parse(readFileSync(join(__dirname, '../../../schemas/plank.schema.json'), 'utf8')) as unknown;

/** A mirror plank's manifest: session-provider, render-only, no grants. */
const MIRROR = `plank: mewd.berth-sessions
face: A2-berth
keel: mewd
consumes:
  mcp_tools: []
  mcp_streams: []
affordance_class: render-only
state_policy: cache-only
swap_invariant: install-uninstall
upstream:
  - session-provider
terminal: NEVER-DECLARED
schema: 1
`;

/** Source that registers session items, so the plank really is a mirror. */
const MIRROR_SOURCE = `
  const controller = vscode.chat.createChatSessionItemController('mewd-berths', refresh);
  controller.items.replace(items);
  await fetchImpl(url, { method: 'GET', headers });
`;

/** The one command the real plank contributes. */
const REVEAL_PACKAGE = {
  contributes: { commands: [{ command: 'mewdBerths.revealInBerths', title: "Reveal in Mew'd Berths" }] },
};

function lint(
  manifestText: string,
  sourceText: string,
  packageJson: unknown,
): ReturnType<typeof lintManifest> {
  const { value, positions } = parseYamlLite(manifestText);
  const plank: PlankSource = {
    manifestPath: 'packages/under-test/plank.yaml',
    manifest: value,
    positions,
    sourceText,
    packageJson,
  };
  return lintManifest(plank, schema);
}

const rules = (manifestText: string, sourceText: string, packageJson: unknown): string[] =>
  lint(manifestText, sourceText, packageJson).map((f) => f.rule);

describe('a mirror that only looks', () => {
  it('passes', () => {
    expect(lint(MIRROR, MIRROR_SOURCE, REVEAL_PACKAGE)).toEqual([]);
  });

  it('passes with no package.json at all — a plank may contribute no command', () => {
    expect(lint(MIRROR, MIRROR_SOURCE, undefined)).toEqual([]);
  });
});

describe('a mock effect command on a session mirror', () => {
  const withCommand = (command: string, title: string): unknown => ({
    contributes: { commands: [{ command, title }] },
  });

  it('is rejected', () => {
    const findings = lint(MIRROR, MIRROR_SOURCE, withCommand('mewdBerths.stopSession', 'Stop session'));
    expect(findings.map((f) => f.rule)).toContain('plank/session-mirror-effect-command');
    expect(findings.find((f) => f.rule === 'plank/session-mirror-effect-command')?.message).toContain(
      'second place the fabric is changed from',
    );
  });

  it('is rejected for each of the four verbs the design named', () => {
    for (const verb of ['spawn', 'send', 'kill', 'mutate']) {
      expect(EFFECT_VERBS).toContain(verb);
      expect(rules(MIRROR, MIRROR_SOURCE, withCommand(`mewdBerths.${verb}Berth`, 'Do the thing'))).toContain(
        'plank/session-mirror-effect-command',
      );
    }
  });

  it('is rejected when only the title gives it away', () => {
    expect(rules(MIRROR, MIRROR_SOURCE, withCommand('mewdBerths.theOtherOne', 'Terminate this berth'))).toContain(
      'plank/session-mirror-effect-command',
    );
  });

  it('is rejected when the command is bound in source but contributed nowhere', () => {
    const source = `${MIRROR_SOURCE}\n vscode.commands.registerCommand('mewdBerths.killBerth', handler);`;
    expect(rules(MIRROR, source, REVEAL_PACKAGE)).toContain('plank/session-mirror-effect-command');
  });
});

describe('a session mirror that writes', () => {
  it('is rejected for the method, whatever the request was called', () => {
    const source = `${MIRROR_SOURCE}\n await fetchImpl(url, { method: 'DELETE', headers });`;
    const findings = lint(MIRROR, source, REVEAL_PACKAGE);
    expect(findings.map((f) => f.rule)).toContain('plank/session-mirror-write-method');
    expect(findings.find((f) => f.rule === 'plank/session-mirror-write-method')?.message).toContain('the method is the');
  });

  it('finds each distinct method once', () => {
    expect(scanWriteMethods("method: 'POST'\nmethod: 'post'\nmethod: \"PATCH\"")).toEqual(['POST', 'PATCH']);
  });

  it('is not tripped by a route whose path happens to contain the word', () => {
    expect(scanWriteMethods("const route = '/dashboard/deleted-sessions';")).toEqual([]);
  });
});

describe('what is not a session mirror', () => {
  /**
   * `fabric-auth` declares the same upstream point — it provides the authentication session
   * everything else borrows a bearer from — and its sign-out legitimately revokes a refresh
   * lineage on the fabric. It is not a session list and these rules are not about it.
   */
  const AUTH_SOURCE = "vscode.authentication.registerAuthenticationProvider('mewd', label, provider);";
  const AUTH_MANIFEST = MIRROR.replace('affordance_class: render-only', 'affordance_class: effect-surfacing');

  it('is left alone, even when it contributes a command that ends something on the fabric', () => {
    const signOut = {
      contributes: {
        commands: [{ command: 'mewdFabric.signOut', title: 'Sign out (revokes the refresh lineage)' }],
      },
    };
    expect(rules(AUTH_MANIFEST, AUTH_SOURCE, signOut)).toEqual([]);
  });

  it('is told apart by what its source registers, not by what its manifest says', () => {
    expect(registersSessionItems(AUTH_SOURCE)).toBe(false);
    expect(registersSessionItems(MIRROR_SOURCE)).toBe(true);
    expect(registersSessionItems("vscode.chat.registerChatSessionItemProvider('t', p);")).toBe(true);
  });
});

describe('a mirror that claims it surfaces an effect', () => {
  it('is rejected on the affordance class — the two cannot both be true', () => {
    const effectful = MIRROR.replace('affordance_class: render-only', 'affordance_class: effect-surfacing');
    expect(rules(effectful, MIRROR_SOURCE, REVEAL_PACKAGE)).toContain('plank/session-mirror-affordance');
  });
});

describe('reading a command name', () => {
  it('splits camelCase, dots and dashes into words', () => {
    expect(words('mewdBerths.revealInBerths')).toEqual(['mewd', 'berths', 'reveal', 'in', 'berths']);
    expect(words('Stop session')).toEqual(['stop', 'session']);
  });

  it('reads only the last dotted segment, so a plank’s own namespace is nobody’s verb', () => {
    expect(isEffectCommand('mewd.update-band.reveal', 'Reveal')).toBe(false);
    expect(isEffectCommand('mewd.band.update', 'Reveal')).toBe(true);
  });

  it('does not flag the one command this pack’s mirror contributes', () => {
    expect(isEffectCommand('mewdBerths.revealInBerths', "Reveal in Mew'd Berths")).toBe(false);
  });

  it('does not flag a refresh — re-reading is what a mirror is for', () => {
    expect(isEffectCommand('mewdBerths.refresh', 'Refresh')).toBe(false);
  });
});

describe('reading a package.json', () => {
  it('finds the contributed commands', () => {
    expect(contributedCommands(REVEAL_PACKAGE)).toEqual([
      { command: 'mewdBerths.revealInBerths', title: "Reveal in Mew'd Berths" },
    ]);
  });

  it('finds nothing in anything that is not one, rather than throwing', () => {
    expect(contributedCommands(undefined)).toEqual([]);
    expect(contributedCommands(null)).toEqual([]);
    expect(contributedCommands({ contributes: { commands: 'no' } })).toEqual([]);
    expect(contributedCommands({ contributes: { commands: [{ title: 'no id' }] } })).toEqual([]);
  });

  it('finds the ids a source binds at runtime', () => {
    expect(registeredCommands("registerCommand('a.b', h); registerTextEditorCommand(\"c.d\", h);")).toEqual([
      'a.b',
      'c.d',
    ]);
  });
});

describe('the rule as a whole', () => {
  it('says nothing about a mirror that only reads', () => {
    expect(checkSessionMirror(contributedCommands(REVEAL_PACKAGE), MIRROR_SOURCE)).toEqual([]);
  });
});
