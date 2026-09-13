/**
 * The private-reference rules.
 *
 * The scanner runs over this repository's own tree, and this file is part of it. So every
 * example that is supposed to trip a rule is assembled at run time rather than written as a
 * literal — otherwise the test proving the rules work would be the very thing they fire on, and
 * the only ways out of that are exempting this file or weakening the rule. Neither is a trade a
 * public repository should make to keep a test tidy.
 *
 * Values that are *allowed* — the RFC 5737 documentation ranges, the loopback and unspecified
 * addresses, the `<user>` placeholder — are written plainly, because the point of those tests is
 * that they do not fire.
 */

import { describe, expect, it } from 'vitest';
import { extraDenyTerms, scanPrivateRefs } from '../src/private-refs.js';

const ids = (text: string, extra: string[] = []): string[] => scanPrivateRefs(text, extra).map((h) => h.ruleId);

/** Assembled, never written down. See the note above. */
const ipv4 = (...octets: number[]): string => octets.join('.');
const ipv6 = (...groups: string[]): string => groups.join(':');
const inZone = (name: string, zone: string): string => [name, zone].join('.');
const homePath = (root: string, user: string): string => ['', root, user, ''].join('/');
const tildePath = (rest: string): string => `~${['', rest].join('/')}`;
const sshTo = (user: string, target: string): string => `ssh ${user}@${target}`;

describe('addresses', () => {
  it('catches an IPv4 literal', () => {
    expect(ids(`const host = "${ipv4(10, 11, 12, 13)}";`)).toEqual(['private-ipv4']);
  });

  it('allows the documentation ranges and the unspecified/loopback addresses', () => {
    expect(ids('0.0.0.0 127.0.0.1 255.255.255.255 192.0.2.7 198.51.100.4 203.0.113.9')).toEqual([]);
  });

  it('catches an IPv6 literal', () => {
    expect(ids(`addr = ${ipv6('2001', '0db8', '85a3', '0000', '0000', '8a2e', '0370', '7334')}`)).toContain(
      'private-ipv6',
    );
  });

  it('does not mistake a version string for an address', () => {
    expect(ids('version 1.2.3 and 22.04 and 1.2.3.4.5.6')).not.toContain('private-ipv4');
  });
});

describe('hostnames', () => {
  it('catches an internal zone', () => {
    expect(ids(`reachable at ${inZone('printer', 'lan')} tomorrow`)).toContain('internal-hostname');
    expect(ids(`http://${inZone('build-box', 'internal')}/`)).toContain('internal-hostname');
  });

  it('catches an overlay zone', () => {
    expect(ids(`reachable at ${inZone('somebox', 'ts.net')}`)).toContain('mesh-hostname');
  });

  it('leaves an ordinary public domain alone', () => {
    expect(ids('https://github.com/knivriver-lab/argo-pack')).toEqual([]);
  });
});

describe('home paths', () => {
  it('catches a tilde path and an absolute home path', () => {
    expect(ids(`cd ${tildePath('Projects/thing')}`)).toContain('home-path');
    expect(ids(homePath('home', 'somebody'))).toContain('home-path');
    expect(ids(homePath('Users', 'somebody'))).toContain('home-path');
  });

  it('allows the placeholder form the docs use to explain the rule', () => {
    expect(ids('/home/<user>/ and /Users/<user>/')).toEqual([]);
  });

  it('leaves a repository-relative path alone', () => {
    expect(ids('packages/law-plank/src/law.ts')).toEqual([]);
  });
});

describe('ssh targets', () => {
  it('catches an invocation naming a concrete host', () => {
    expect(ids(sshTo('deploy', 'build-box'))).toContain('ssh-target');
  });
});

describe('extra deny terms', () => {
  it('are read from the environment and never echoed back', () => {
    expect(extraDenyTerms({ PACK_LINT_DENY: ' alpha , beta ,, ' })).toEqual(['alpha', 'beta']);

    const hits = scanPrivateRefs('the ALPHA cluster', ['alpha']);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.ruleId).toBe('deny-term');
    expect(hits[0]?.match).not.toContain('alpha');
    expect(hits[0]?.match).toContain('redacted');
  });

  it('default to none when the variable is unset', () => {
    expect(extraDenyTerms({})).toEqual([]);
  });
});

describe('positions', () => {
  it('are one-based, so they can be printed as file:line:column', () => {
    const hits = scanPrivateRefs(`ok\nhost = ${ipv4(10, 0, 0, 5)}\n`);
    expect(hits[0]?.line).toBe(2);
    expect(hits[0]?.column).toBe(8);
  });
});

describe('this repository', () => {
  // Asserted for real by the private-refs CI job, which scans every tracked file. If that job is
  // green, nothing in the tree — including this file — names a host, an address or a home path.
  it('keeps its own prose clean', () => {
    expect(ids('argo-pack is public and names no host, address or home directory')).toEqual([]);
  });
});
