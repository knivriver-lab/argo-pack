/**
 * The webview rules, each with a passing fixture beside the failing one.
 *
 * A band webview holds no credential, names no host, opens no connection and navigates nowhere.
 * That is the entire security argument for the served bands — the extension host does the
 * authenticated fetch, so the page never has a reason to hold a bearer — and these are the tests
 * that turn the argument into something the build can fail on.
 *
 * The last block runs the rules over the assets this repository actually ships, because a rule
 * that is only ever exercised against fixtures is a rule nobody has to satisfy.
 */

import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import {
  checkContentSecurityPolicy,
  isWebviewAsset,
  scanWebviewAsset,
  WEBVIEW_RULE_DEFINITION_FILES,
} from '../src/webview-guard.js';
import { lintTree } from '../src/lint.js';

const ROOT = join(__dirname, '../../..');

const rules = (text: string): string[] => [...new Set(scanWebviewAsset(text).map((h) => h.ruleId))];

/** A page that keeps every promise. Each failing fixture below differs from it in one line. */
const GOOD_PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta http-equiv="Content-Security-Policy" content="{{csp}}" />
    <link rel="stylesheet" href="{{style}}" />
  </head>
  <body>
    <button id="signin-button" type="button">Sign in to Mew'd</button>
    <script nonce="{{nonce}}" src="{{script}}"></script>
  </body>
</html>
`;

const GOOD_SCRIPT = `const vscode = acquireVsCodeApi();
window.addEventListener('message', (event) => paint(event.data));
button.addEventListener('click', () => vscode.postMessage({ type: 'signIn' }));
element.textContent = row.title;
`;

describe('a webview asset that keeps its promises', () => {
  it('passes', () => {
    expect(scanWebviewAsset(GOOD_PAGE)).toEqual([]);
    expect(scanWebviewAsset(GOOD_SCRIPT)).toEqual([]);
  });

  it('may still talk about theme tokens, because a word is not a credential', () => {
    expect(scanWebviewAsset('<p>The swatches are the editor’s theme tokens, not this plank’s.</p>')).toEqual([]);
  });
});

describe('a token in a webview', () => {
  it('fails a credential named as a field', () => {
    expect(rules(`const t = data.access_token;`)).toContain('token');
    expect(rules(`{"refresh_token": "x"}`)).toContain('token');
    expect(rules(`const s = payload.client_secret;`)).toContain('token');
    expect(rules(`const v = state.code_verifier;`)).toContain('token');
    expect(rules(`const b = message.accessToken;`)).toContain('token');
  });

  it('fails an Authorization header being set', () => {
    expect(rules(`headers: { authorization: 'x' }`)).toContain('authorization-header');
    expect(rules(`xhr.setRequestHeader("Authorization", value)`)).toEqual([]);
    expect(rules(`const h = "Authorization: " + token;`)).toContain('authorization-header');
  });

  // The two fixtures below are shaped like credentials and are deliberately not entropic enough
  // to be mistaken for one by a secret scanner. A fixture that trips gitleaks teaches everybody
  // to ignore gitleaks.
  it('fails a bearer written down', () => {
    expect(rules(`const h = 'Bearer not-a-real-token-0000';`)).toContain('bearer-literal');
  });

  it('fails a JWT written down', () => {
    expect(rules(`const t = "eyJhbGciOiJI.eyJzdWIiOiIx.c2lnbmF0dXJl";`)).toContain('jwt-literal');
  });
});

describe('a host literal in a webview', () => {
  it('fails an absolute URL', () => {
    expect(rules(`<img src="https://example.test/logo.png" />`)).toContain('host-literal');
    expect(rules(`const base = 'http://example.test';`)).toContain('host-literal');
  });

  it('allows the XML namespaces an SVG cannot be written without', () => {
    expect(rules(`<svg xmlns="http://www.w3.org/2000/svg"></svg>`)).toEqual([]);
  });

  it('leaves the editor’s own webview origin alone, because it is not an http URL', () => {
    expect(rules(`<link rel="stylesheet" href="vscode-webview://abc/media/band.css" />`)).toEqual([]);
  });
});

describe('a webview that reaches out on its own', () => {
  it('fails a fetch', () => {
    expect(rules(`const r = await fetch(url);`)).toContain('direct-fetch');
    expect(rules(`fetch ('/dashboard/attention')`)).toContain('direct-fetch');
  });

  it('fails the other ways of making a request', () => {
    expect(rules(`const x = new XMLHttpRequest();`)).toContain('direct-fetch');
    expect(rules(`const s = new WebSocket(url);`)).toContain('direct-fetch');
    expect(rules(`const e = new EventSource(url);`)).toContain('direct-fetch');
    expect(rules(`navigator.sendBeacon(url, body);`)).toContain('direct-fetch');
    expect(rules(`importScripts('worker.js');`)).toContain('direct-fetch');
  });

  it('fails a navigation, because a 401 is an affordance and not a redirect', () => {
    expect(rules(`location.href = signInUrl;`)).toContain('navigation');
    expect(rules(`window.open(signInUrl);`)).toContain('navigation');
    expect(rules(`location.replace(url);`)).toContain('navigation');
  });

  it('fails HTML assembled from data', () => {
    expect(rules(`node.innerHTML = row.title;`)).toContain('unsafe-render');
    expect(rules(`node.insertAdjacentHTML('beforeend', html);`)).toContain('unsafe-render');
    expect(rules(`document.write(body);`)).toContain('unsafe-render');
  });

  it('says why, in the finding', () => {
    const hit = scanWebviewAsset('const r = fetch(url);')[0];
    expect(hit?.because).toContain('extension host does the authenticated fetch');
  });

  it('reports the line and column, so the finding can be looked at', () => {
    const hit = scanWebviewAsset('ok\nok\n  const r = fetch(url);')[0];
    expect(hit?.line).toBe(3);
    expect(hit?.column).toBe(13);
  });
});

describe('the content security policy', () => {
  it('accepts a page that refuses everything first', () => {
    expect(checkContentSecurityPolicy(GOOD_PAGE)).toEqual([]);
    expect(
      checkContentSecurityPolicy(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src x" />`),
    ).toEqual([]);
  });

  it('fails a page with no policy at all', () => {
    const problems = checkContentSecurityPolicy('<!doctype html><html><body>hello</body></html>');
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain('no Content-Security-Policy');
  });

  it('fails a policy that permits by default', () => {
    const problems = checkContentSecurityPolicy(
      `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'unsafe-inline'" />`,
    );
    expect(problems[0]?.message).toContain('permits by default');
  });

  it('points at the line the policy is on', () => {
    const problems = checkContentSecurityPolicy(`<html>\n<head>\n<meta http-equiv="Content-Security-Policy" content="default-src 'self'" />\n`);
    expect(problems[0]?.line).toBe(3);
  });
});

describe('what counts as a webview asset', () => {
  it('is what a webview can load, under a plank’s media directory', () => {
    expect(isWebviewAsset('packages/served-bands/media/band.js')).toBe(true);
    expect(isWebviewAsset('packages/served-bands/media/band.html')).toBe(true);
    expect(isWebviewAsset('packages/served-bands/media/band.css')).toBe(true);
    expect(isWebviewAsset('packages/served-bands/media/mewd.svg')).toBe(true);
  });

  it('is not the plank’s source, which is where the fetch belongs', () => {
    expect(isWebviewAsset('packages/served-bands/src/client.ts')).toBe(false);
    expect(isWebviewAsset('packages/served-bands/README.md')).toBe(false);
    expect(isWebviewAsset('docs/units/0001-served-bands.md')).toBe(false);
  });

  it('is not documentation that happens to sit beside one', () => {
    expect(isWebviewAsset('packages/served-bands/media/notes.md')).toBe(false);
  });
});

describe('the assets this repository ships', () => {
  it('pass every webview rule', () => {
    expect(lintTree(ROOT, { only: 'webviews' }).findings).toEqual([]);
  });

  it('are actually being looked at — a rule over nothing proves nothing', () => {
    expect(lintTree(ROOT, { only: 'webviews' }).webviewAssetsScanned).toBeGreaterThanOrEqual(5);
  });

  it('do not include the file that defines the rules, which necessarily contains the patterns', () => {
    expect(WEBVIEW_RULE_DEFINITION_FILES).toContain('packages/pack-lint/src/webview-guard.ts');
    expect(isWebviewAsset('packages/pack-lint/src/webview-guard.ts')).toBe(false);
  });
});
