/**
 * A fabric that exists only in this test run.
 *
 * The base URL is `https://example.test` — RFC 2606 reserved, obviously fictional, and not
 * anybody's. No test in this pack may name a real host, and a fixture is the easiest place for
 * one to get in. The payload below is a plausible `/dashboard/sessions` answer and nothing more:
 * it was written here, from the route's shape, and not copied from anywhere that serves it.
 */

import type { FetchLike } from '../src/client.js';

/** Reserved for documentation and testing. Resolves nowhere, on purpose. */
export const BASE_URL = 'https://example.test';

/** The bearer the host is expected to put on the request, and that nothing else may hold. */
export const BEARER = 'test-access-token-9d41f0';

export interface RecordedRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
}

export interface MockReply {
  readonly status?: number;
  readonly body?: unknown;
  readonly text?: string;
  readonly throws?: string;
}

export interface MockFabric {
  readonly fetch: FetchLike;
  readonly requests: RecordedRequest[];
}

export function mockFabric(handler: (request: RecordedRequest) => MockReply): MockFabric {
  const requests: RecordedRequest[] = [];

  const fetch: FetchLike = async (input, init) => {
    const request: RecordedRequest = {
      url: input,
      method: init?.method ?? 'GET',
      headers: init?.headers ?? {},
    };
    requests.push(request);

    const reply = handler(request);
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

/** A fetch that fails the test if anything calls it. Used to prove a code path reaches nowhere. */
export function forbiddenFetch(why: string): FetchLike {
  return async () => {
    throw new Error(`a request was made where none was permitted: ${why}`);
  };
}

/**
 * A `/dashboard/sessions` payload.
 *
 * Deliberately uneven: one entry in each state the mirror knows, one whose state word is not in
 * the vocabulary, and one that is barely an object at all. A fixture where every row is tidy
 * tests the happy path and nothing else.
 */
export const SESSIONS_PAYLOAD = {
  sessions: [
    {
      id: 'brt-001',
      title: 'Rebuild the chart index',
      status: 'running',
      detail: 'step 3 of 7',
      started_at: '2026-09-13T09:00:00.000Z',
      updated_at: '2026-09-13T09:14:00.000Z',
    },
    {
      id: 'brt-002',
      title: 'Reconcile the ticket ledger',
      status: 'blocked',
      reason: 'waiting on a human word',
      started_at: 1757750400,
    },
    { id: 'brt-003', name: 'Nightly sweep', state: 'completed' },
    { id: 'brt-004', title: 'Vacuum the map cache', state: 'failed', why: 'the route answered 500' },
    { id: 'brt-005', title: 'Something new', status: 'percolating' },
    { id: 'brt-006' },
  ],
} as const;

/** How many berths `SESSIONS_PAYLOAD` should produce. */
export const SESSIONS_COUNT = SESSIONS_PAYLOAD.sessions.length;
