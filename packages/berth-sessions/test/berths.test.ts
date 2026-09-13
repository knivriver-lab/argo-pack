/**
 * The payload, and what it becomes.
 *
 * Also the one test in this package that reaches into another: the route this plank reads is
 * asserted to be the route the P1 Berths band reads, by importing the band's own table rather
 * than by repeating the string. A mirror that drifted onto a different route would still pass
 * every other test in here and would be showing the operator a second, quieter answer.
 */

import { describe, expect, it } from 'vitest';
import { BANDS } from '../../served-bands/src/bands.js';
import { BERTHS_ROUTE, berthsUrl, toBerths, toEpochMs, toState } from '../src/berths.js';
import { BASE_URL, SESSIONS_COUNT, SESSIONS_PAYLOAD } from './mock-fabric.js';

describe('the route', () => {
  it('is the one the P1 Berths band reads, not a second opinion about it', () => {
    const berths = BANDS.find((band) => band.id === 'berths');
    expect(berths?.route).toBe(BERTHS_ROUTE);
  });

  it('joins to a base url with exactly one slash', () => {
    expect(berthsUrl(BASE_URL)).toBe(`${BASE_URL}/dashboard/sessions`);
    expect(berthsUrl(`${BASE_URL}///`)).toBe(`${BASE_URL}/dashboard/sessions`);
  });
});

describe('reading a payload', () => {
  const berths = toBerths(SESSIONS_PAYLOAD);

  it('finds every session', () => {
    expect(berths).toHaveLength(SESSIONS_COUNT);
  });

  it('reads the label, the state and the note', () => {
    expect(berths[0]).toMatchObject({
      id: 'brt-001',
      label: 'Rebuild the chart index',
      state: 'working',
      detail: 'step 3 of 7',
    });
  });

  it('maps the fabric’s words onto the states the view knows', () => {
    expect(berths.map((b) => b.state)).toEqual(['working', 'waiting', 'done', 'failed', 'unknown', 'unknown']);
  });

  it('falls back to the id when there is nothing else to call a berth', () => {
    expect(berths[5]).toMatchObject({ id: 'brt-006', label: 'brt-006', state: 'unknown' });
  });

  it('reads a timestamp whether it came in seconds or as a date', () => {
    expect(berths[0]?.startedAt).toBe(Date.parse('2026-09-13T09:00:00.000Z'));
    expect(berths[1]?.startedAt).toBe(1757750400 * 1000);
  });
});

describe('a state this plank cannot read', () => {
  it('is unknown, and is never quietly called finished', () => {
    expect(toState('percolating')).toBe('unknown');
    expect(toState(null)).toBe('unknown');
    expect(toState('')).toBe('unknown');
  });

  it('does not match by prefix — running and runnable are two words', () => {
    expect(toState('running')).toBe('working');
    expect(toState('runnable')).toBe('unknown');
  });

  it('is not case-sensitive about the fabric’s spelling', () => {
    expect(toState('  In-Progress ')).toBe('working');
  });
});

describe('a timestamp that is not one', () => {
  it('is null rather than now — a berth stamped with render time reads as fresh news', () => {
    expect(toEpochMs('not a date')).toBeNull();
    expect(toEpochMs(null)).toBeNull();
    expect(toEpochMs(0)).toBeNull();
    expect(toEpochMs({})).toBeNull();
  });
});

describe('an answer with no list in it', () => {
  /**
   * The P1 band renders an unreadable object field-by-field so the operator can see something is
   * there. A native session list has no room for that: a row in it is a session, and rows
   * invented out of an object's keys would be things in the operator's session list that are not
   * sessions. The band stays the place that shows what could not be read.
   */
  it('yields no berths at all, rather than rows invented out of its keys', () => {
    expect(toBerths({ ok: true, count: 3 })).toEqual([]);
    expect(toBerths('nothing')).toEqual([]);
    expect(toBerths(null)).toEqual([]);
  });

  it('still reads a bare array, and the other keys a route might use', () => {
    expect(toBerths([{ id: 'a' }])).toHaveLength(1);
    expect(toBerths({ items: [{ id: 'a' }, { id: 'b' }] })).toHaveLength(2);
  });
});
