/**
 * The one authenticated request, and the fact that it is the only kind this plank makes.
 */

import { describe, expect, it } from 'vitest';
import { berthRequest, fetchBerths } from '../src/client.js';
import { BASE_URL, BEARER, SESSIONS_PAYLOAD, mockFabric } from './mock-fabric.js';

describe('the request the extension host builds', () => {
  const request = berthRequest(BASE_URL, BEARER);

  it('goes to the berths route under the operator’s origin', () => {
    expect(request.url).toBe(`${BASE_URL}/dashboard/sessions`);
  });

  it('carries the P1 bearer', () => {
    expect(request.headers['authorization']).toBe(`Bearer ${BEARER}`);
  });

  it('is a read, and there is no branch that makes it anything else', () => {
    expect(request.method).toBe('GET');
  });
});

describe('the request that actually goes out', () => {
  it('is the request that was built — header and all', async () => {
    const fabric = mockFabric(() => ({ body: SESSIONS_PAYLOAD }));
    await fetchBerths(BASE_URL, BEARER, fabric.fetch);

    expect(fabric.requests).toHaveLength(1);
    expect(fabric.requests[0]?.method).toBe('GET');
    expect(fabric.requests[0]?.url).toBe(`${BASE_URL}/dashboard/sessions`);
    expect(fabric.requests[0]?.headers['authorization']).toBe(`Bearer ${BEARER}`);
  });

  it('returns what the route answered, stamped with when it was read', async () => {
    const fabric = mockFabric(() => ({ body: SESSIONS_PAYLOAD }));
    const at = new Date('2026-09-13T10:00:00.000Z');
    const result = await fetchBerths(BASE_URL, BEARER, fabric.fetch, () => at);

    expect(result.kind).toBe('berths');
    if (result.kind !== 'berths') return;
    expect(result.at).toBe(at.toISOString());
    expect(result.body).toEqual(SESSIONS_PAYLOAD);
  });
});

describe('what the fabric can say instead', () => {
  it('treats 401 as a state, not an error — the remedy is a sign-in this plank does not own', async () => {
    const fabric = mockFabric(() => ({ status: 401 }));
    expect((await fetchBerths(BASE_URL, BEARER, fabric.fetch)).kind).toBe('unauthorized');
  });

  it('treats 403 as a different thing, and says so', async () => {
    const fabric = mockFabric(() => ({ status: 403 }));
    const result = await fetchBerths(BASE_URL, BEARER, fabric.fetch);
    expect(result.kind).toBe('error');
    if (result.kind !== 'error') return;
    expect(result.message).toContain('Signing in again will not change that');
  });

  it('reports an unreachable fabric rather than an empty list', async () => {
    const fabric = mockFabric(() => ({ throws: 'ENOTFOUND' }));
    const result = await fetchBerths(BASE_URL, BEARER, fabric.fetch);
    expect(result.kind).toBe('error');
    if (result.kind !== 'error') return;
    expect(result.status).toBe(0);
    expect(result.message).toContain('could not be reached');
  });

  it('reports an answer that is not JSON rather than pretending it read one', async () => {
    const fabric = mockFabric(() => ({ text: '<html>a proxy sign-in page</html>' }));
    const result = await fetchBerths(BASE_URL, BEARER, fabric.fetch);
    expect(result.kind).toBe('error');
    if (result.kind !== 'error') return;
    expect(result.message).toContain('not JSON');
  });
});
