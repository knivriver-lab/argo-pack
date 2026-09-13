/**
 * PKCE, checked from both sides.
 *
 * A challenge is only worth anything if the server can derive it from the verifier the token
 * request presents, so the tests here do exactly that rather than asserting that a hash function
 * was called.
 */

import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  CHALLENGE_METHOD,
  challengeFor,
  createPkce,
  createState,
  createVerifier,
  isWellFormedVerifier,
  verifyChallenge,
} from '../src/pkce.js';

/** A deterministic stand-in for `randomBytes`, so a flow can be replayed. */
const fixedBytes = (fill: number) => (size: number) => Buffer.alloc(size, fill);

describe('the verifier', () => {
  it('is inside the length RFC 7636 allows, using the alphabet it allows', () => {
    expect(isWellFormedVerifier(createVerifier())).toBe(true);
  });

  it('is 43 characters — 32 bytes, base64url, unpadded', () => {
    expect(createVerifier().length).toBe(43);
  });

  it('carries no base64 padding or non-url characters', () => {
    for (let i = 0; i < 50; i++) {
      expect(createVerifier()).not.toMatch(/[+/=]/);
    }
  });

  it('is different every time', () => {
    const seen = new Set(Array.from({ length: 100 }, () => createVerifier()));
    expect(seen.size).toBe(100);
  });

  it('refuses something too short to be one', () => {
    expect(isWellFormedVerifier('short')).toBe(false);
  });
});

describe('the challenge', () => {
  it('is the S256 of the verifier, as the fabric would compute it', () => {
    const verifier = createVerifier();
    const expected = createHash('sha256')
      .update(verifier, 'ascii')
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(challengeFor(verifier)).toBe(expected);
  });

  it('verifies against the verifier it came from', () => {
    const pkce = createPkce();
    expect(verifyChallenge(pkce.verifier, pkce.challenge)).toBe(true);
  });

  it('does not verify against a different verifier', () => {
    const a = createPkce();
    const b = createPkce();
    expect(verifyChallenge(a.verifier, b.challenge)).toBe(false);
  });

  it('does not verify a verifier the RFC would not have accepted', () => {
    expect(verifyChallenge('too-short', challengeFor('too-short'))).toBe(false);
  });

  it('is only ever S256 — there is no plain to fall back to', () => {
    expect(createPkce().method).toBe('S256');
    expect(CHALLENGE_METHOD).toBe('S256');
  });
});

describe('replaying a flow', () => {
  it('is deterministic given the randomness', () => {
    const first = createPkce(fixedBytes(7));
    const second = createPkce(fixedBytes(7));
    expect(first).toEqual(second);
    expect(verifyChallenge(first.verifier, second.challenge)).toBe(true);
  });
});

describe('state', () => {
  it('is random, and is not the verifier', () => {
    const state = createState();
    expect(state.length).toBeGreaterThanOrEqual(20);
    expect(state).not.toBe(createState());
  });
});
