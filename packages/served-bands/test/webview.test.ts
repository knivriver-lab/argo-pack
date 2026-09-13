/**
 * The webview, run as the file that ships.
 *
 * The binding this whole plank exists to keep is that the page holds no token and talks to
 * nothing. The tests below are the two halves of that:
 *
 *   - everything the page knows arrived through `postMessage`, and
 *   - every way out of the page is a trap in the harness that nothing ever springs.
 *
 * And the 401 case, which is the one that would be easiest to get wrong: it produces a button,
 * the button posts a message, and no part of it navigates anywhere.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { BAND_SCRIPT_PATH, mountBandWebview } from './webview-harness.js';
import { hostMessageFor, isViewMessage, SIGN_IN_REASON } from '../src/protocol.js';

const SCRIPT = readFileSync(BAND_SCRIPT_PATH, 'utf8');

describe('on load', () => {
  it('says it is ready, and asks for nothing else', () => {
    const band = mountBandWebview();
    expect(band.posted).toEqual([{ type: 'ready' }]);
    expect(band.reachedFor).toEqual([]);
  });

  it('paints nothing until the host sends something', () => {
    const band = mountBandWebview();
    expect(band.rows()).toEqual([]);
  });
});

describe('data arrives only by postMessage', () => {
  it('paints the rows the host sent', () => {
    const band = mountBandWebview();
    band.send({
      type: 'data',
      band: 'needs-you',
      rows: [
        { title: 'a unit is waiting', detail: 'docs/units/0001.md', badge: 'open' },
        { title: 'another', detail: null, badge: null },
      ],
      at: '1970-01-01T00:00:00.000Z',
    });

    expect(band.rows()).toEqual(['a unit is waiting open docs/units/0001.md', 'another']);
    expect(band.el('stamp').textContent).toContain('1970-01-01');
    expect(band.reachedFor).toEqual([]);
  });

  it('never fetches anything to fill them in', () => {
    const band = mountBandWebview();
    band.send({ type: 'loading', band: 'helm' });
    band.send({ type: 'data', band: 'helm', rows: [{ title: 'x', detail: null, badge: null }], at: 'now' });
    band.click('refresh');

    // The refresh is a request to the host, not a request to anything else.
    expect(band.posted).toEqual([{ type: 'ready' }, { type: 'refresh' }]);
    expect(band.reachedFor).toEqual([]);
  });

  it('says so when there is nothing to show, rather than looking broken', () => {
    const band = mountBandWebview();
    band.send({ type: 'data', band: 'map', rows: [], at: 'now' });
    expect(band.el('state').textContent).toBe('Nothing here.');
  });

  it('replaces the previous rows rather than appending to them', () => {
    const band = mountBandWebview();
    const row = (title: string) => ({ title, detail: null, badge: null });
    band.send({ type: 'data', band: 'map', rows: [row('one'), row('two')], at: 'now' });
    band.send({ type: 'data', band: 'map', rows: [row('three')], at: 'now' });
    expect(band.rows()).toEqual(['three']);
  });

  it('ignores a message shaped like nothing it knows', () => {
    const band = mountBandWebview();
    band.send({ type: 'something-else' });
    band.send(undefined);
    band.send('a string');
    expect(band.rows()).toEqual([]);
    expect(band.reachedFor).toEqual([]);
  });
});

describe('a 401 is an affordance, not a redirect', () => {
  it('shows the sign-in when the host says the fabric refused the session', () => {
    const band = mountBandWebview();
    band.send(hostMessageFor('berths', { kind: 'unauthorized' }));

    expect(band.el('signin').hidden).toBe(false);
    expect(band.el('signin-reason').textContent).toBe(SIGN_IN_REASON);
    expect(band.el('refresh').hidden).toBe(true);
  });

  it('asks the host to sign in, and goes nowhere itself', () => {
    const band = mountBandWebview();
    band.send(hostMessageFor('berths', { kind: 'unauthorized' }));
    band.click('signin-button');

    expect(band.posted).toEqual([{ type: 'ready' }, { type: 'signIn' }]);
    expect(band.reachedFor).toEqual([]);
  });

  it('hides the sign-in again once data arrives', () => {
    const band = mountBandWebview();
    band.send(hostMessageFor('berths', { kind: 'unauthorized' }));
    band.send({ type: 'data', band: 'berths', rows: [], at: 'now' });
    expect(band.el('signin').hidden).toBe(true);
  });

  it('shows the error, and not a sign-in, on a 403', () => {
    const band = mountBandWebview();
    band.send(hostMessageFor('berths', { kind: 'error', status: 403, message: 'the fabric declined the route' }));
    expect(band.el('signin').hidden).toBe(true);
    expect(band.el('state').textContent).toBe('the fabric declined the route');
  });

  it('says what to set when nothing is configured', () => {
    const band = mountBandWebview();
    band.send({ type: 'unconfigured', band: 'map', reason: 'Set mewd.fabric.baseUrl…' });
    expect(band.el('state').textContent).toContain('mewd.fabric.baseUrl');
    expect(band.el('signin').hidden).toBe(true);
  });
});

describe('the shipped script', () => {
  it('has exactly one bridge to the host', () => {
    expect(SCRIPT.match(/acquireVsCodeApi\s*\(/g)).toHaveLength(1);
  });

  it('carries no credential and no origin', () => {
    expect(SCRIPT).not.toMatch(/\b(?:access_token|refresh_token|client_secret|authorization\s*[:=])/i);
    expect(SCRIPT).not.toMatch(/\bhttps?:\/\//);
  });

  it('paints with textContent, never by assembling HTML', () => {
    expect(SCRIPT).not.toMatch(/\b(?:innerHTML|outerHTML|insertAdjacentHTML)\b/);
    expect(SCRIPT).toMatch(/textContent/);
  });
});

describe('messages from a view', () => {
  it('are recognised only in the three shapes the host answers', () => {
    expect(isViewMessage({ type: 'ready' })).toBe(true);
    expect(isViewMessage({ type: 'refresh' })).toBe(true);
    expect(isViewMessage({ type: 'signIn' })).toBe(true);
  });

  it('are refused otherwise — nothing arriving from a page is trusted, including its shape', () => {
    expect(isViewMessage({ type: 'exec' })).toBe(false);
    expect(isViewMessage({})).toBe(false);
    expect(isViewMessage(null)).toBe(false);
    expect(isViewMessage('refresh')).toBe(false);
  });
});
