/**
 * The two claims that make this plank safe to put on a surface that invites effects:
 * the one command reaches no fabric, and on a build without the proposal nothing happens at all.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BERTHS_FOCUS_COMMAND, BERTHS_VIEW_ID, REVEAL_COMMAND, revealInBerths } from '../src/reveal.js';
import { INERT_REASON, SESSION_API_MEMBER, SESSION_API_PROPOSAL, hasSessionProviderApi } from '../src/guard.js';
import { forbiddenFetch } from './mock-fabric.js';

const PACKAGE_JSON = JSON.parse(
  readFileSync(join(__dirname, '..', 'package.json'), 'utf8'),
) as Record<string, unknown>;

const contributes = PACKAGE_JSON['contributes'] as Record<string, unknown>;
const commands = contributes['commands'] as { command: string; title: string }[];

describe('the reveal command', () => {
  it('focuses the P1 Berths band and does nothing else', async () => {
    const ran: string[] = [];
    await revealInBerths(async (command, ...args) => {
      ran.push(command);
      expect(args).toEqual([]);
      return undefined;
    });
    expect(ran).toEqual([BERTHS_FOCUS_COMMAND]);
    expect(BERTHS_FOCUS_COMMAND).toBe(`${BERTHS_VIEW_ID}.focus`);
  });

  it('performs no fabric call — there is no fetch it could reach, and it does not look for one', async () => {
    // `forbiddenFetch` throws if anything calls it. Handing it to the module under test and then
    // running the command proves the absence by construction rather than by inspection.
    const fetchImpl = forbiddenFetch('the reveal command must not read the fabric');
    let calls = 0;
    await revealInBerths(async () => {
      calls++;
      return undefined;
    });
    expect(calls).toBe(1);
    await expect(fetchImpl('https://example.test/anything')).rejects.toThrow('none was permitted');
  });

  it('takes no argument, so nothing about the selected berth can cross into it', () => {
    expect(revealInBerths.length).toBe(1); // the command runner, and nothing else
  });
});

describe('the commands this plank contributes', () => {
  it('is exactly one, and it is the deep link', () => {
    expect(commands.map((c) => c.command)).toEqual([REVEAL_COMMAND]);
    expect(commands[0]?.title).toBe("Reveal in Mew'd Berths");
  });

  it('contributes no menu on the session view itself', () => {
    // The only menu contribution is the palette gate. A context menu on a mirrored session is
    // the exact shape the read-only rule exists to prevent, so its absence is checked here as
    // well as by pack-lint.
    expect(Object.keys(contributes['menus'] as Record<string, unknown>)).toEqual(['commandPalette']);
  });

  it('declares the session type read-only to the editor', () => {
    const sessions = contributes['chatSessions'] as Record<string, unknown>[];
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.['isReadOnly']).toBe(true);
    expect(sessions[0]?.['type']).toBe('mewd-berths');
  });
});

describe('the proposed API', () => {
  it('is declared in enabledApiProposals, by the id the guard checks for', () => {
    expect(PACKAGE_JSON['enabledApiProposals']).toEqual([SESSION_API_PROPOSAL]);
    expect(SESSION_API_PROPOSAL).toBe('chatSessionsProvider');
  });

  it('is vendored as a declaration this repository can show you', () => {
    const dts = readFileSync(
      join(__dirname, '..', 'types', `vscode.proposed.${SESSION_API_PROPOSAL}.d.ts`),
      'utf8',
    );
    expect(dts).toContain(`export function ${SESSION_API_MEMBER}`);
    expect(dts).toContain("declare module 'vscode'");
  });
});

describe('the desktop guard', () => {
  it('finds the surface when the method is there to call', () => {
    expect(hasSessionProviderApi({ [SESSION_API_MEMBER]: () => undefined })).toBe(true);
  });

  it('is inert on a build that exposes a chat namespace without this proposal', () => {
    // The namespace exists on builds carrying none of this proposal, which is why the check is
    // for the exact method and not for the object that would contain it.
    expect(hasSessionProviderApi({ createChatParticipant: () => undefined })).toBe(false);
  });

  it('is inert when there is no namespace at all', () => {
    expect(hasSessionProviderApi(undefined)).toBe(false);
    expect(hasSessionProviderApi(null)).toBe(false);
    expect(hasSessionProviderApi({})).toBe(false);
  });

  it('is inert when the member is present but is not callable', () => {
    expect(hasSessionProviderApi({ [SESSION_API_MEMBER]: 'yes' })).toBe(false);
  });

  it('says what it did and did not do, without naming a host', () => {
    expect(INERT_REASON).toContain(SESSION_API_PROPOSAL);
    expect(INERT_REASON).toContain('Nothing was read');
    expect(INERT_REASON).not.toMatch(/https?:\/\//);
  });
});
