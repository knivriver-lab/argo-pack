/**
 * A fabric that exists only in this test run.
 *
 * The base URL is `https://example.test` — RFC 2606 reserved, obviously fictional, and not
 * anybody's. No test in this pack may name a real host, and a fixture is the easiest place for
 * one to get in.
 */

import type { FetchLike } from '../src/oauth.js';

/** Reserved for documentation and testing. Resolves nowhere, on purpose. */
export const BASE_URL = 'https://example.test';

export const CLIENT_ID = 'argo-pack-test-client';
export const REDIRECT_URI = 'vscode://mewd.fabric-auth/callback';

export interface RecordedRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string;
  /** The body read as a form, which is what every OAuth request here sends. */
  readonly form: Record<string, string>;
}

export interface MockReply {
  readonly status?: number;
  /** Serialised as JSON. Use `text` for something that is not. */
  readonly body?: unknown;
  readonly text?: string;
  /** Throw instead of answering, as an unreachable host would. */
  readonly throws?: string;
}

export interface MockFabric {
  readonly fetch: FetchLike;
  readonly requests: RecordedRequest[];
  /** The requests that went to a given path, in order. */
  to(path: string): RecordedRequest[];
}

export function mockFabric(handler: (request: RecordedRequest) => MockReply): MockFabric {
  const requests: RecordedRequest[] = [];

  const fetch: FetchLike = async (input, init) => {
    const body = init?.body ?? '';
    const request: RecordedRequest = {
      url: input,
      method: init?.method ?? 'GET',
      headers: init?.headers ?? {},
      body,
      form: Object.fromEntries(new URLSearchParams(body)),
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

  return {
    fetch,
    requests,
    to: (path) => requests.filter((r) => new URL(r.url).pathname === path),
  };
}

/** A `SecretStorage`, in a Map, so the test can look at exactly what was written. */
export class MockSecretStorage {
  readonly entries = new Map<string, string>();
  readonly writes: string[] = [];
  readonly deletes: string[] = [];

  async get(key: string): Promise<string | undefined> {
    return this.entries.get(key);
  }

  async store(key: string, value: string): Promise<void> {
    this.writes.push(key);
    this.entries.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.deletes.push(key);
    this.entries.delete(key);
  }

  /** Everything in the store, as one string — for asserting what a token is *not* beside. */
  dump(): string {
    return JSON.stringify([...this.entries.entries()]);
  }
}
