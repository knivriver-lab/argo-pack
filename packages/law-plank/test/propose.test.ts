/**
 * The one effect in the pack.
 *
 * Two things have to be true about it, and they pull in opposite directions, which is why both
 * are tested:
 *
 *   - with a session, the call goes out as a `propose` tool call with the bearer on it, and
 *   - without one, nothing happens at all. Not a queued call, not a retry, not a prompt that
 *     fires something later. The plank is simply inert, and every local thing it does goes on
 *     working.
 *
 * The manifest side of it — `consumes.mcp_tools: [propose]` being a live grant rather than a
 * dead one — is `pack-lint`'s to check, and it does, over this plank's real source.
 */

import { describe, expect, it } from 'vitest';
import { parseFrontMatter } from '../src/front-matter.js';
import {
  actionTitle,
  draftProposal,
  openQuestionsOf,
  proposeOpenQuestion,
  PROPOSE_TOOL,
} from '../src/propose.js';
import { HttpMcpCaller, MCP_PATH, parseRpcBody, textOfToolResult, type FetchLike, type McpCaller } from '../src/mcp.js';

/** RFC 2606 reserved. No test in this pack names a real host. */
const ENDPOINT = `https://example.test${MCP_PATH}`;
const BEARER = 'access-token-dddddddddddddddddddd';

const UNIT = `---
id: 0001-served-bands
title: The served bands
pathway: foundry
human_word:
  - dispatch
  - land
weight: W2
open_questions:
  - Whether keel stays a single value once a second workspace shape exists.
  - "  Whether the map band should chart units or sessions.  "
---

## Spec
`;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function mockEndpoint(reply: {
  status?: number;
  contentType?: string;
  body?: unknown;
  text?: string;
  throws?: string;
}): { fetch: FetchLike; requests: Recorded[] } {
  const requests: Recorded[] = [];
  const fetch: FetchLike = async (input, init) => {
    requests.push({
      url: input,
      method: init?.method ?? 'GET',
      headers: init?.headers ?? {},
      body: JSON.parse(init?.body ?? 'null') as unknown,
    });
    if (reply.throws !== undefined) throw new Error(reply.throws);
    const status = reply.status ?? 200;
    const text = reply.text ?? JSON.stringify(reply.body ?? {});
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name) => (name.toLowerCase() === 'content-type' ? (reply.contentType ?? 'application/json') : null) },
      text: async () => text,
    };
  };
  return { fetch, requests };
}

describe('reading the questions out of a unit', () => {
  const fm = parseFrontMatter(UNIT);

  it('finds them in order, trimmed', () => {
    expect(openQuestionsOf(fm)).toEqual([
      'Whether keel stays a single value once a second workspace shape exists.',
      'Whether the map band should chart units or sessions.',
    ]);
  });

  it('finds none in a document that has none', () => {
    expect(openQuestionsOf(parseFrontMatter('---\nid: 0002-x\n---\n'))).toEqual([]);
    expect(openQuestionsOf(parseFrontMatter('no front matter here'))).toEqual([]);
  });
});

describe('the action', () => {
  it('shows the question it is offering to propose', () => {
    expect(actionTitle('Whether keel stays a single value')).toBe('Propose “Whether keel stays a single value” as an OIP');
  });

  it('elides a long one rather than filling the menu with it', () => {
    const title = actionTitle('x'.repeat(200));
    expect(title.length).toBeLessThan(90);
    expect(title).toContain('…');
  });

  it('flattens a question that was written across lines', () => {
    expect(actionTitle('one\n  two')).toContain('one two');
  });
});

describe('with a session', () => {
  const proposal = draftProposal('0001-served-bands', 'docs/units/0001-served-bands.md', 'Whether the map charts units');

  it('calls propose, with the bearer on the request', async () => {
    const endpoint = mockEndpoint({ body: { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'OIP-14 opened' }] } } });
    const caller = new HttpMcpCaller(ENDPOINT, BEARER, endpoint.fetch);

    const result = await proposeOpenQuestion(caller, proposal);

    expect(result).toEqual({ ok: true, text: 'OIP-14 opened' });
    const request = endpoint.requests[0];
    expect(request?.url).toBe(ENDPOINT);
    expect(request?.method).toBe('POST');
    expect(request?.headers['authorization']).toBe(`Bearer ${BEARER}`);
  });

  it('names the tool the manifest declares, and hands over the question with its context', async () => {
    const endpoint = mockEndpoint({ body: { jsonrpc: '2.0', id: 1, result: { content: [] } } });
    await proposeOpenQuestion(new HttpMcpCaller(ENDPOINT, BEARER, endpoint.fetch), proposal);

    expect(endpoint.requests[0]?.body).toMatchObject({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: PROPOSE_TOOL,
        arguments: {
          unit: '0001-served-bands',
          source: 'docs/units/0001-served-bands.md',
          question: 'Whether the map charts units',
          title: '0001-served-bands: Whether the map charts units',
        },
      },
    });
  });

  it('reads an answer that came back as an event stream', async () => {
    const endpoint = mockEndpoint({
      contentType: 'text/event-stream',
      text: 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"queued"}]}}\n\n',
    });
    expect(await proposeOpenQuestion(new HttpMcpCaller(ENDPOINT, BEARER, endpoint.fetch), proposal)).toEqual({
      ok: true,
      text: 'queued',
    });
  });

  it('reports a 401 as one, rather than as a proposal that worked', async () => {
    const endpoint = mockEndpoint({ status: 401 });
    expect(await proposeOpenQuestion(new HttpMcpCaller(ENDPOINT, BEARER, endpoint.fetch), proposal)).toMatchObject({
      ok: false,
      code: 'unauthorized',
    });
  });

  it('reports a 403 as the fabric declining the tool for this seat', async () => {
    const endpoint = mockEndpoint({ status: 403 });
    const result = await proposeOpenQuestion(new HttpMcpCaller(ENDPOINT, BEARER, endpoint.fetch), proposal);
    expect(result).toMatchObject({ ok: false, code: 'forbidden' });
    expect(result?.ok === false && result.message).toContain(PROPOSE_TOOL);
  });

  it('reports a JSON-RPC error', async () => {
    const endpoint = mockEndpoint({ body: { jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'unknown unit' } } });
    expect(await proposeOpenQuestion(new HttpMcpCaller(ENDPOINT, BEARER, endpoint.fetch), proposal)).toEqual({
      ok: false,
      code: '-32602',
      message: 'unknown unit',
    });
  });

  it('reports a tool that answered with isError', async () => {
    const endpoint = mockEndpoint({
      body: { jsonrpc: '2.0', id: 1, result: { isError: true, content: [{ type: 'text', text: 'that unit is landed' }] } },
    });
    expect(await proposeOpenQuestion(new HttpMcpCaller(ENDPOINT, BEARER, endpoint.fetch), proposal)).toEqual({
      ok: false,
      code: 'tool_error',
      message: 'that unit is landed',
    });
  });

  it('reports an unreachable fabric rather than throwing into the editor', async () => {
    const endpoint = mockEndpoint({ throws: 'ENOTFOUND' });
    expect(await proposeOpenQuestion(new HttpMcpCaller(ENDPOINT, BEARER, endpoint.fetch), proposal)).toMatchObject({
      ok: false,
      code: 'unreachable',
    });
  });
});

describe('without a session', () => {
  const proposal = draftProposal('0001-served-bands', 'docs/units/0001-served-bands.md', 'anything at all');

  it('does nothing, and says nothing happened', async () => {
    expect(await proposeOpenQuestion(null, proposal)).toBeNull();
  });

  it('makes no request of any kind', async () => {
    const endpoint = mockEndpoint({ body: {} });
    const inert: McpCaller | null = null;
    await proposeOpenQuestion(inert, proposal);
    expect(endpoint.requests).toEqual([]);
  });
});

describe('reading what came back', () => {
  it('flattens the text parts of a tool result', () => {
    expect(textOfToolResult({ content: [{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }] })).toBe(
      'a\nb',
    );
  });

  it('is empty rather than wrong when there is no content', () => {
    expect(textOfToolResult({})).toBe('');
    expect(textOfToolResult(null)).toBe('');
  });

  it('takes the first JSON-RPC envelope out of an event stream', () => {
    expect(parseRpcBody('text/event-stream', 'retry: 1000\ndata: {"id":1}\ndata: {"id":2}\n')).toEqual({ id: 1 });
  });

  it('reports nothing rather than guessing at an unparseable body', () => {
    expect(parseRpcBody('application/json', 'not json')).toBeNull();
    expect(parseRpcBody('text/event-stream', 'event: ping\n')).toBeNull();
  });
});
