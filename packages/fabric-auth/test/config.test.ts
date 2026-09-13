/**
 * The two settings.
 *
 * There is no default for either, and the tests below are as much about that as about parsing:
 * an unset setting produces a sentence an operator can act on, and never a guess at a host.
 */

import { describe, expect, it } from 'vitest';
import { BASE_URL_SETTING, CLIENT_ID_SETTING, readFabricConfig } from '../src/config.js';
import { BASE_URL, CLIENT_ID } from './mock-fabric.js';

const ok = (base: unknown = BASE_URL, client: unknown = CLIENT_ID) => readFabricConfig(base, client);

describe('a configured fabric', () => {
  it('is accepted', () => {
    expect(ok()).toEqual({ ok: true, config: { baseUrl: BASE_URL, clientId: CLIENT_ID } });
  });

  it('loses a trailing slash, so no route is built with two', () => {
    expect(ok(`${BASE_URL}/`)).toMatchObject({ ok: true, config: { baseUrl: BASE_URL } });
  });

  it('tolerates whitespace around a pasted value', () => {
    expect(ok(`  ${BASE_URL}  `, `  ${CLIENT_ID} `)).toMatchObject({
      ok: true,
      config: { baseUrl: BASE_URL, clientId: CLIENT_ID },
    });
  });
});

describe('an unconfigured one', () => {
  it('names the setting to fill in, rather than inventing a host', () => {
    const result = ok('');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.problem).toContain(BASE_URL_SETTING);
  });

  it('says why there is no client id to invent', () => {
    const result = ok(BASE_URL, '');
    expect(result.ok === false && result.problem).toContain(CLIENT_ID_SETTING);
    expect(result.ok === false && result.problem).toContain('does not register itself');
  });

  it('refuses something that is not a URL', () => {
    expect(ok('fabric-over-there').ok).toBe(false);
  });
});

describe('the origin', () => {
  it('accepts https', () => {
    expect(ok('https://example.test').ok).toBe(true);
  });

  it('accepts http on loopback, because OAuth 2.1 does', () => {
    expect(ok('http://localhost:8080').ok).toBe(true);
    expect(ok('http://127.0.0.1:8080').ok).toBe(true);
  });

  it('refuses http anywhere else — tokens do not travel in clear', () => {
    const result = ok('http://example.test');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.problem).toContain('in clear');
  });

  it('refuses a scheme that is not http at all', () => {
    expect(ok('ftp://example.test').ok).toBe(false);
  });
});
