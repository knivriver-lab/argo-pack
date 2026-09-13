/**
 * The mirror end to end, and the claim the whole plank rests on: the bearer goes onto the
 * request and into nothing else.
 *
 * The no-token checks are done by serialising the result and searching the text, rather than by
 * reading the types. The types already say there is no field for a credential; a test that only
 * re-read them would be checking that TypeScript works. Searching the serialised output catches
 * the case the types cannot — a token that arrived inside a `detail` string, a `tooltip`, or a
 * resource path, because it was in the fabric's answer or because somebody interpolated it in.
 */

import { describe, expect, it } from 'vitest';
import { itemFieldsFor, itemFieldsForAll, pathFor } from '../src/items.js';
import { readMirror, emptyReason, SIGNED_OUT, UNCONFIGURED, UNAUTHORIZED, type MirrorDeps } from '../src/mirror.js';
import { BASE_URL, BEARER, SESSIONS_COUNT, SESSIONS_PAYLOAD, mockFabric } from './mock-fabric.js';

function deps(over: Partial<MirrorDeps> = {}): MirrorDeps {
  const fabric = mockFabric(() => ({ body: SESSIONS_PAYLOAD }));
  return {
    baseUrl: () => BASE_URL,
    bearer: async () => BEARER,
    fetchImpl: fabric.fetch,
    ...over,
  };
}

describe('a mirror of a configured, signed-in editor', () => {
  it('lists the berths the mock route answered with', async () => {
    const mirror = await readMirror(deps());
    expect(mirror.kind).toBe('berths');
    if (mirror.kind !== 'berths') return;
    expect(mirror.berths).toHaveLength(SESSIONS_COUNT);
    expect(mirror.berths.map((b) => b.label)).toContain('Rebuild the chart index');
  });

  it('projects them into items with a label, a state and a note', async () => {
    const mirror = await readMirror(deps());
    if (mirror.kind !== 'berths') throw new Error('expected berths');
    const fields = itemFieldsForAll(mirror.berths);

    expect(fields).toHaveLength(SESSIONS_COUNT);
    expect(fields[0]).toMatchObject({
      path: '/brt-001',
      label: 'Rebuild the chart index',
      description: 'step 3 of 7',
      status: 'in-progress',
    });
    expect(fields.map((f) => f.status)).toEqual([
      'in-progress',
      'needs-input',
      'completed',
      'failed',
      // A berth whose state could not be read carries no status at all. Not `completed`:
      // a check that cannot read its input reports unknown, never pass.
      'none',
      'none',
    ]);
  });
});

describe('the bearer', () => {
  it('is put on the request', async () => {
    const fabric = mockFabric(() => ({ body: SESSIONS_PAYLOAD }));
    await readMirror(deps({ fetchImpl: fabric.fetch }));
    expect(fabric.requests[0]?.headers['authorization']).toBe(`Bearer ${BEARER}`);
  });

  it('is nowhere in the mirror the view is built from', async () => {
    const mirror = await readMirror(deps());
    expect(JSON.stringify(mirror)).not.toContain(BEARER);
  });

  it('is nowhere in the items handed to the editor', async () => {
    const mirror = await readMirror(deps());
    if (mirror.kind !== 'berths') throw new Error('expected berths');
    const serialised = JSON.stringify(itemFieldsForAll(mirror.berths));
    expect(serialised).not.toContain(BEARER);
    expect(serialised.toLowerCase()).not.toContain('authorization');
    expect(serialised.toLowerCase()).not.toContain('bearer');
  });

  it('does not survive a fabric that echoes it back inside its own payload', async () => {
    // The plank cannot stop a fabric from saying something silly. What it can do is not have a
    // field that carries it onward: the projection reads named keys, so an unexpected one is
    // dropped rather than passed to the editor.
    const echoing = mockFabric(() => ({
      body: { sessions: [{ id: 'brt-x', title: 'Echo', status: 'running', access_token: BEARER }] },
    }));
    const mirror = await readMirror(deps({ fetchImpl: echoing.fetch }));
    if (mirror.kind !== 'berths') throw new Error('expected berths');
    expect(JSON.stringify(itemFieldsForAll(mirror.berths))).not.toContain(BEARER);
  });
});

describe('the operator’s origin', () => {
  it('never reaches an item’s resource path — identity comes from the session id', async () => {
    const mirror = await readMirror(deps());
    if (mirror.kind !== 'berths') throw new Error('expected berths');
    for (const fields of itemFieldsForAll(mirror.berths)) {
      expect(fields.path).not.toContain(BASE_URL);
      expect(fields.path).not.toContain('//');
      expect(fields.path.startsWith('/')).toBe(true);
    }
  });

  it('cannot be smuggled in through an id that looks like a url', () => {
    expect(pathFor('https://elsewhere.test/a?b=c')).toBe('/https%3A%2F%2Felsewhere.test%2Fa%3Fb%3Dc');
  });

  it('is absent from the tooltip, which says what the view is instead', () => {
    const tooltip = itemFieldsFor({
      id: 'brt-001',
      label: 'Rebuild the chart index',
      state: 'working',
      detail: 'step 3 of 7',
      startedAt: null,
      updatedAt: null,
    }).tooltip;
    expect(tooltip).not.toContain(BASE_URL);
    expect(tooltip).toContain('read-only mirror');
    expect(tooltip).toContain('Nothing here changes the session');
  });
});

describe('when there is nothing to mirror', () => {
  it('says so when no fabric has been named, and reads nothing', async () => {
    const fabric = mockFabric(() => ({ body: SESSIONS_PAYLOAD }));
    const mirror = await readMirror(deps({ baseUrl: () => null, fetchImpl: fabric.fetch }));
    expect(mirror).toEqual({ kind: 'unconfigured', reason: UNCONFIGURED });
    expect(fabric.requests).toHaveLength(0);
  });

  it('says so when the editor is signed out, and reads nothing', async () => {
    const fabric = mockFabric(() => ({ body: SESSIONS_PAYLOAD }));
    const mirror = await readMirror(deps({ bearer: async () => null, fetchImpl: fabric.fetch }));
    expect(mirror).toEqual({ kind: 'signed-out', reason: SIGNED_OUT });
    expect(fabric.requests).toHaveLength(0);
  });

  it('distinguishes a fabric that declined from one that is quiet', async () => {
    const declined = mockFabric(() => ({ status: 401 }));
    expect(await readMirror(deps({ fetchImpl: declined.fetch }))).toEqual({
      kind: 'unauthorized',
      reason: UNAUTHORIZED,
    });

    const quiet = mockFabric(() => ({ body: { sessions: [] } }));
    const mirror = await readMirror(deps({ fetchImpl: quiet.fetch }));
    expect(mirror.kind).toBe('berths');
    expect(emptyReason(mirror)).toBe('The fabric is holding no sessions.');
  });

  it('gives every empty view a reason, so a quiet fabric never looks like an unreachable one', async () => {
    for (const over of [
      { baseUrl: () => null },
      { bearer: async () => null },
      { fetchImpl: mockFabric(() => ({ status: 401 })).fetch },
      { fetchImpl: mockFabric(() => ({ throws: 'ENOTFOUND' })).fetch },
      { fetchImpl: mockFabric(() => ({ body: { sessions: [] } })).fetch },
    ]) {
      expect(emptyReason(await readMirror(deps(over)))).not.toBeNull();
    }
  });

  it('has no reason to give when there is something to show', async () => {
    expect(emptyReason(await readMirror(deps()))).toBeNull();
  });
});
