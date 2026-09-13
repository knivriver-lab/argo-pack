/**
 * PKCE, and the two random values the authorization request needs.
 *
 * RFC 7636 with `S256` and nothing else. `plain` is a permitted method in the RFC and is not
 * implemented here: a downgrade that the client itself offers is a downgrade the client cannot
 * later refuse, and there is no deployment this pack needs it for.
 *
 * Nothing in this file imports an editor API, so the challenge can be verified in a test the
 * same way the fabric verifies it in production.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const CHALLENGE_METHOD = 'S256';

/** RFC 7636 §4.1 puts the verifier between 43 and 128 characters. 32 bytes base64url is 43. */
const VERIFIER_BYTES = 32;
const STATE_BYTES = 16;

const VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;

export interface Pkce {
  readonly verifier: string;
  readonly challenge: string;
  readonly method: typeof CHALLENGE_METHOD;
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Injected in tests so the flow can be replayed; production always gets `randomBytes`. */
export type RandomBytes = (size: number) => Buffer;

export function createVerifier(random: RandomBytes = randomBytes): string {
  return base64url(random(VERIFIER_BYTES));
}

export function createState(random: RandomBytes = randomBytes): string {
  return base64url(random(STATE_BYTES));
}

export function challengeFor(verifier: string): string {
  return base64url(createHash('sha256').update(verifier, 'ascii').digest());
}

export function createPkce(random: RandomBytes = randomBytes): Pkce {
  const verifier = createVerifier(random);
  return { verifier, challenge: challengeFor(verifier), method: CHALLENGE_METHOD };
}

export function isWellFormedVerifier(verifier: string): boolean {
  return VERIFIER_RE.test(verifier);
}

/**
 * What the authorization server does with the verifier the token request presents.
 *
 * It lives here rather than only in the fabric because a client that cannot demonstrate the
 * relationship it is claiming has no business claiming it, and because the test that proves the
 * challenge is derived correctly has to be able to check it from the other side.
 */
export function verifyChallenge(verifier: string, challenge: string): boolean {
  if (!isWellFormedVerifier(verifier)) return false;
  const expected = Buffer.from(challengeFor(verifier), 'ascii');
  const actual = Buffer.from(challenge, 'ascii');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
