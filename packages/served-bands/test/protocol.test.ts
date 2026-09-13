/**
 * What crosses the bridge, and what it was made from.
 *
 * Shaping the response into rows happens in the extension host, before anything is posted. That
 * placement is the point of `rows.ts` and it is what these tests are really about: the page is
 * handed strings, so it never needs the code that walks an unknown object.
 */

import { describe, expect, it } from 'vitest';
import { hostMessageFor, SIGN_IN_REASON } from '../src/protocol.js';
import { toRows } from '../src/rows.js';

describe('a result becomes a message', () => {
  it('data becomes rows and a stamp', () => {
    expect(hostMessageFor('helm', { kind: 'data', body: ['one', 'two'], at: 'then' })).toEqual({
      type: 'data',
      band: 'helm',
      rows: [
        { title: 'one', detail: null, badge: null },
        { title: 'two', detail: null, badge: null },
      ],
      at: 'then',
    });
  });

  it('a 401 becomes a sign-in, and says why', () => {
    expect(hostMessageFor('map', { kind: 'unauthorized' })).toEqual({
      type: 'signIn',
      band: 'map',
      reason: SIGN_IN_REASON,
    });
  });

  it('anything else becomes an error carrying the status', () => {
    expect(hostMessageFor('berths', { kind: 'error', status: 500, message: 'boom' })).toEqual({
      type: 'error',
      band: 'berths',
      status: 500,
      message: 'boom',
    });
  });

  it('carries no token, no URL and no header, whatever came back', () => {
    const message = hostMessageFor('needs-you', {
      kind: 'data',
      body: { items: [{ title: 'a thing' }] },
      at: 'then',
    });
    expect(JSON.stringify(message)).not.toMatch(/authorization|Bearer|access_token|https?:\/\//i);
  });
});

describe('rows', () => {
  it('reads a bare list', () => {
    expect(toRows([{ title: 'one', status: 'open', detail: 'because' }])).toEqual([
      { title: 'one', detail: 'because', badge: 'open' },
    ]);
  });

  it('finds the list a route hung off a key', () => {
    for (const key of ['items', 'entries', 'rows', 'results', 'data']) {
      expect(toRows({ [key]: ['a'] })).toEqual([{ title: 'a', detail: null, badge: null }]);
    }
  });

  it('falls back through the name-ish keys', () => {
    expect(toRows([{ name: 'by name' }])[0]?.title).toBe('by name');
    expect(toRows([{ id: '0001' }])[0]?.title).toBe('0001');
    expect(toRows([{ nothing: 'useful' }])[0]?.title).toBe('#1');
  });

  it('renders a plain object as its own fields', () => {
    expect(toRows({ sessions: 3, held: true })).toEqual([
      { title: 'sessions', detail: '3', badge: null },
      { title: 'held', detail: 'true', badge: null },
    ]);
  });

  it('says what it got rather than showing nothing', () => {
    expect(toRows(null)[0]?.title).toContain('nothing this band can show');
    // An entry none of the known keys fit still says which fields it had.
    expect(toRows([{ nested: { a: 1 }, other: 2 }])[0]).toEqual({
      title: '#1',
      detail: 'nested, other',
      badge: null,
    });
    expect(toRows([{}])[0]?.detail).toBe('no fields');
  });

  it('produces strings, and only strings', () => {
    for (const row of toRows([{ title: 1, status: false, detail: 2.5 }])) {
      expect(typeof row.title).toBe('string');
      for (const value of [row.detail, row.badge]) {
        expect(value === null || typeof value === 'string').toBe(true);
      }
    }
  });
});
