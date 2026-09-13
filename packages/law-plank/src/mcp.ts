/**
 * Calling one MCP tool over HTTP, with the bearer the editor is holding.
 *
 * This is the smallest client that can honestly be called an MCP client: a single JSON-RPC
 * `tools/call` to the fabric's MCP endpoint, with `Authorization: Bearer` on it. There is no
 * session negotiation, no tool listing, no notification channel and no reconnect. A plank that
 * calls exactly one tool does not need a protocol stack; it needs one request it can be held to.
 *
 * The endpoint answers either `application/json` or `text/event-stream` — the Streamable HTTP
 * transport allows both — so both are read. Anything else is reported rather than guessed at.
 *
 * `fetch` is injected. The test that asserts the bearer is on the request is looking at the
 * request this code builds, and the one that asserts the plank is inert without a session never
 * gets here at all.
 */

export const MCP_PATH = '/mcp';

export interface McpHttpResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<McpHttpResponse>;

export type McpResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly code: string; readonly message: string };

/** What anything that can call a tool looks like. Two implementations: HTTP, and a test's. */
export interface McpCaller {
  callTool(name: string, args: Record<string, unknown>): Promise<McpResult>;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The `content` of a tool result, flattened to the text a person can be shown. */
export function textOfToolResult(result: unknown): string {
  if (!isObject(result)) return '';
  const content = result['content'];
  if (!Array.isArray(content)) return '';
  return content
    .filter(isObject)
    .map((part) => (typeof part['text'] === 'string' ? part['text'] : ''))
    .filter((text) => text !== '')
    .join('\n');
}

/** One JSON-RPC envelope out of a body that may be a JSON document or an SSE stream. */
export function parseRpcBody(contentType: string | null, body: string): unknown {
  const type = (contentType ?? '').toLowerCase();

  if (type.includes('text/event-stream')) {
    for (const line of body.split('\n')) {
      const trimmed = line.trimEnd();
      if (!trimmed.startsWith('data:')) continue;
      try {
        return JSON.parse(trimmed.slice('data:'.length).trim()) as unknown;
      } catch {
        continue;
      }
    }
    return null;
  }

  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}

export class HttpMcpCaller implements McpCaller {
  readonly #endpoint: string;
  readonly #bearer: string;
  readonly #fetch: FetchLike;
  #nextId = 1;

  constructor(endpoint: string, bearer: string, fetchImpl: FetchLike) {
    this.#endpoint = endpoint;
    this.#bearer = bearer;
    this.#fetch = fetchImpl;
  }

  /** The request this caller makes, exposed so a test can assert on it rather than around it. */
  requestFor(name: string, args: Record<string, unknown>, id: number): { headers: Record<string, string>; body: string } {
    return {
      headers: {
        authorization: `Bearer ${this.#bearer}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    };
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpResult> {
    const id = this.#nextId++;
    const { headers, body } = this.requestFor(name, args, id);

    let response: McpHttpResponse;
    try {
      response = await this.#fetch(this.#endpoint, { method: 'POST', headers, body });
    } catch (err) {
      return { ok: false, code: 'unreachable', message: err instanceof Error ? err.message : String(err) };
    }

    if (response.status === 401) {
      return { ok: false, code: 'unauthorized', message: 'the fabric did not accept this session' };
    }
    if (response.status === 403) {
      return {
        ok: false,
        code: 'forbidden',
        message: `the fabric declined ${name} for this session — the seat does not hold the role the tool needs`,
      };
    }

    const text = await response.text();
    if (!response.ok) {
      return { ok: false, code: 'http_error', message: `the fabric answered ${response.status}` };
    }

    const envelope = parseRpcBody(response.headers.get('content-type'), text);
    if (!isObject(envelope)) {
      return { ok: false, code: 'invalid_response', message: 'the endpoint did not answer with a JSON-RPC envelope' };
    }

    const error = envelope['error'];
    if (isObject(error)) {
      const message = typeof error['message'] === 'string' ? error['message'] : 'the tool call failed';
      return { ok: false, code: String(error['code'] ?? 'rpc_error'), message };
    }

    const result = envelope['result'];
    if (isObject(result) && result['isError'] === true) {
      return { ok: false, code: 'tool_error', message: textOfToolResult(result) || `${name} reported a failure` };
    }

    return { ok: true, text: textOfToolResult(result) };
  }
}
