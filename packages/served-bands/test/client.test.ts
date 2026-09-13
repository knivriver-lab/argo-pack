/**
 * The band fetch, which is the only place a bearer is put on a request.
 *
 * Every assertion here is about the request this code actually builds and the answer it actually
 * returns. The 401 case is the interesting one: it is not an error, because the view responds to
 * it with an affordance rather than a message, and that distinction is made here rather than in
 * the page.
 */

import { describe, expect, it } from 'vitest';
import { BANDS, bandById, bandByViewId, urlFor } from '../src/bands.js';
import { bandRequest, fetchBand, type FetchLike } from '../src/client.js';

/** RFC 2606 reserved. No test in this pack names a real host. */
const BASE_URL = 'https://example.test';
const BEARER = 'access-token-cccccccccccccccccccc';

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
}

function mockRoute(reply: { status?: number; body?: unknown; text?: string; throws?: string }): {
  fetch: FetchLike;
  requests: Recorded[];
} {
  const requests: Recorded[] = [];
  const fetch: FetchLike = async (input, init) => {
    requests.push({ url: input, method: init?.method ?? 'GET', headers: init?.headers ?? {} });
    if (reply.throws !== undefined) throw new Error(reply.throws);
    const status = reply.status ?? 200;
    const text = reply.text ?? (reply.body === undefined ? '' : JSON.stringify(reply.body));
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => JSON.parse(text) as unknown,
      text: async () => text,
    };
  };
  return { fetch, requests };
}

describe('the four bands', () => {
  it('are the four the fabric serves, each on its own route', () => {
    expect(BANDS.map((b) => [b.viewId, b.route])).toEqual([
      ['mewd.needsYou', '/dashboard/attention'],
      ['mewd.helm', '/dashboard/coordination'],
      ['mewd.berths', '/dashboard/sessions'],
      ['mewd.map', '/dashboard/chart'],
    ]);
  });

  it('carry no origin of their own — the route is a path', () => {
    for (const band of BANDS) {
      expect(band.route.startsWith('/')).toBe(true);
      expect(band.route).not.toMatch(/:\/\//);
    }
  });

  it('are findable by id and by view id', () => {
    expect(bandById('helm')?.title).toBe('Helm');
    expect(bandByViewId('mewd.map')?.id).toBe('map');
    expect(bandById('nothing-like-this')).toBeUndefined();
  });

  it('join the configured origin with exactly one slash', () => {
    const band = bandById('needs-you')!;
    expect(urlFor(BASE_URL, band)).toBe(`${BASE_URL}/dashboard/attention`);
    expect(urlFor(`${BASE_URL}/`, band)).toBe(`${BASE_URL}/dashboard/attention`);
  });
});

describe('the request', () => {
  it('carries the bearer, on every band', () => {
    for (const band of BANDS) {
      const request = bandRequest(BASE_URL, band, BEARER);
      expect(request.headers['authorization']).toBe(`Bearer ${BEARER}`);
      expect(request.url).toBe(`${BASE_URL}${band.route}`);
      expect(request.method).toBe('GET');
    }
  });

  it('is the request the fetch actually makes', async () => {
    for (const band of BANDS) {
      const route = mockRoute({ body: [] });
      await fetchBand(BASE_URL, band, BEARER, route.fetch);
      expect(route.requests).toEqual([
        {
          url: `${BASE_URL}${band.route}`,
          method: 'GET',
          headers: { authorization: `Bearer ${BEARER}`, accept: 'application/json' },
        },
      ]);
    }
  });
});

describe('what comes back', () => {
  const band = BANDS[0]!;

  it('is data, stamped with when it arrived', async () => {
    const route = mockRoute({ body: { items: [{ title: 'one' }] } });
    const result = await fetchBand(BASE_URL, band, BEARER, route.fetch, () => new Date(0));
    expect(result).toEqual({ kind: 'data', body: { items: [{ title: 'one' }] }, at: '1970-01-01T00:00:00.000Z' });
  });

  it('is `unauthorized` on a 401 — not an error, because the view answers it with a button', async () => {
    const route = mockRoute({ status: 401 });
    expect(await fetchBand(BASE_URL, band, BEARER, route.fetch)).toEqual({ kind: 'unauthorized' });
  });

  it('is an error on a 403, and says signing in again would not help', async () => {
    const route = mockRoute({ status: 403 });
    const result = await fetchBand(BASE_URL, band, BEARER, route.fetch);
    expect(result.kind).toBe('error');
    expect(result.kind === 'error' && result.message).toContain('will not change that');
  });

  it('is an error, with the status, on anything else', async () => {
    const route = mockRoute({ status: 503, text: 'the fabric is restarting' });
    const result = await fetchBand(BASE_URL, band, BEARER, route.fetch);
    expect(result).toMatchObject({ kind: 'error', status: 503 });
    expect(result.kind === 'error' && result.message).toContain('restarting');
  });

  it('says the host could not be reached, rather than throwing into the view', async () => {
    const route = mockRoute({ throws: 'ENOTFOUND' });
    const result = await fetchBand(BASE_URL, band, BEARER, route.fetch);
    expect(result).toMatchObject({ kind: 'error', status: 0 });
    expect(result.kind === 'error' && result.message).toContain('could not be reached');
  });

  it('says so when a 200 was not JSON', async () => {
    const route = mockRoute({ text: '<html>signed out</html>' });
    const result = await fetchBand(BASE_URL, band, BEARER, route.fetch);
    expect(result).toMatchObject({ kind: 'error' });
    expect(result.kind === 'error' && result.message).toContain('not JSON');
  });
});
