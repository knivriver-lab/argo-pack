/**
 * A webview, small enough to hold.
 *
 * `media/band.js` is the file that ships, so the tests run *that file*, in a sandbox with just
 * enough of a document to paint into and nothing else at all. A browser engine would run it too,
 * and would also supply the hundred globals whose absence is the thing being asserted — here,
 * every way out of the page is a trap that records having been reached for, so "the webview
 * issues no fetch of its own" is something the test observes rather than something it hopes.
 *
 * The element model covers what the band script uses: an id, a class, text, a hidden flag,
 * children, and one listener per event. Anything the script reached for that is not here would
 * throw, which is the correct outcome for a page that grew a second way of doing things.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

export const BAND_SCRIPT_PATH = join(__dirname, '../media/band.js');

class FakeNode {
  readonly tag: string;
  id = '';
  className = '';
  textContent = '';
  hidden = false;
  readonly children: FakeNode[] = [];
  readonly listeners = new Map<string, ((event: unknown) => void)[]>();

  constructor(tag: string) {
    this.tag = tag;
  }

  get firstChild(): FakeNode | undefined {
    return this.children[0];
  }

  appendChild(child: FakeNode): FakeNode {
    this.children.push(child);
    return child;
  }

  removeChild(child: FakeNode): FakeNode {
    const at = this.children.indexOf(child);
    if (at !== -1) this.children.splice(at, 1);
    return child;
  }

  addEventListener(type: string, handler: (event: unknown) => void): void {
    const existing = this.listeners.get(type) ?? [];
    existing.push(handler);
    this.listeners.set(type, existing);
  }

  /** Fire a listener the way a person pressing the thing would. */
  dispatch(type: string, event: unknown = {}): void {
    for (const handler of this.listeners.get(type) ?? []) handler(event);
  }

  /** Everything rendered under this node, flattened — one row per line. */
  text(): string {
    if (this.children.length === 0) return this.textContent;
    return this.children.map((c) => c.text()).join(' ');
  }
}

/** The ids `media/band.html` provides. The script looks up exactly these. */
const IDS = ['state', 'rows', 'blurb', 'stamp', 'refresh', 'signin', 'signin-reason', 'signin-button'] as const;

export type ElementId = (typeof IDS)[number];

export interface Harness {
  /** Messages the page sent to the extension host. */
  readonly posted: unknown[];
  /** Every global the page reached for that it is not allowed to have. */
  readonly reachedFor: string[];
  /** Deliver a host message, the way `webview.postMessage` arrives. */
  send(message: unknown): void;
  /** Press something. */
  click(id: ElementId): void;
  el(id: ElementId): FakeNode;
  /** The rows currently painted, as `[title, badge?, detail?]` joined. */
  rows(): string[];
}

export function mountBandWebview(): Harness {
  const elements = new Map<string, FakeNode>();
  for (const id of IDS) {
    const node = new FakeNode('div');
    node.id = id;
    elements.set(id, node);
  }

  const posted: unknown[] = [];
  const reachedFor: string[] = [];
  const windowListeners = new Map<string, ((event: unknown) => void)[]>();

  /** A global that must not be used. Touching it is recorded, then refused. */
  const trap = (name: string): (() => never) =>
    function forbidden(): never {
      reachedFor.push(name);
      throw new Error(`the band webview reached for ${name}`);
    };

  const sandbox = {
    acquireVsCodeApi: () => ({
      postMessage: (message: unknown) => {
        posted.push(message);
      },
      // Present so the script could use them; a test asserts it does not need to.
      getState: () => undefined,
      setState: () => undefined,
    }),
    document: {
      getElementById: (id: string) => elements.get(id) ?? null,
      createElement: (tag: string) => new FakeNode(tag),
      body: new FakeNode('body'),
      get location() {
        reachedFor.push('document.location');
        throw new Error('the band webview reached for document.location');
      },
      write: trap('document.write'),
    },
    window: {
      addEventListener: (type: string, handler: (event: unknown) => void) => {
        const existing = windowListeners.get(type) ?? [];
        existing.push(handler);
        windowListeners.set(type, existing);
      },
      open: trap('window.open'),
    },
    // The ways out. None of them is used; each one says so if it is.
    fetch: trap('fetch'),
    XMLHttpRequest: trap('XMLHttpRequest'),
    WebSocket: trap('WebSocket'),
    EventSource: trap('EventSource'),
    importScripts: trap('importScripts'),
    navigator: {
      get sendBeacon(): never {
        reachedFor.push('navigator.sendBeacon');
        throw new Error('the band webview reached for navigator.sendBeacon');
      },
    },
    get location(): never {
      reachedFor.push('location');
      throw new Error('the band webview reached for location');
    },
    console,
  };

  runInNewContext(readFileSync(BAND_SCRIPT_PATH, 'utf8'), sandbox, { filename: 'band.js' });

  const el = (id: ElementId): FakeNode => {
    const found = elements.get(id);
    if (found === undefined) throw new Error(`no element ${id}`);
    return found;
  };

  return {
    posted,
    reachedFor,
    send: (message) => {
      for (const handler of windowListeners.get('message') ?? []) handler({ data: message });
    },
    click: (id) => el(id).dispatch('click'),
    el,
    rows: () => el('rows').children.map((row) => row.text()),
  };
}
