/**
 * The page, and the policy on it.
 *
 * The template on disk is what ships, so it is what is rendered here — a test against a string
 * literal would be a test of a string literal. Every band gets the same page with a different
 * title, and every one of them gets the same refusal at the top of it.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BANDS } from '../src/bands.js';
import { contentSecurityPolicy, renderBandPage } from '../src/page.js';

const TEMPLATE = readFileSync(join(__dirname, '../media/band.html'), 'utf8');
const SCRIPT = readFileSync(join(__dirname, '../media/band.js'), 'utf8');

const CSP_SOURCE = 'vscode-webview://an-editor-minted-origin';
const NONCE = 'a-nonce-value';

function render(band = BANDS[0]!): string {
  return renderBandPage(TEMPLATE, {
    band,
    cspSource: CSP_SOURCE,
    styleUri: `${CSP_SOURCE}/media/band.css`,
    scriptUri: `${CSP_SOURCE}/media/band.js`,
    nonce: NONCE,
  });
}

describe('the content security policy', () => {
  const policy = contentSecurityPolicy(CSP_SOURCE, NONCE);

  it('starts by refusing everything', () => {
    expect(policy.startsWith("default-src 'none'")).toBe(true);
  });

  it('says out loud that the page opens no connection of its own', () => {
    expect(policy).toContain("connect-src 'none'");
  });

  it('permits styles only from the origin the editor minted', () => {
    expect(policy).toContain(`style-src ${CSP_SOURCE}`);
    expect(policy).not.toMatch(/style-src[^;]*unsafe-inline/);
  });

  it('permits one script, by nonce, and nothing inline beyond it', () => {
    expect(policy).toContain(`script-src 'nonce-${NONCE}'`);
    expect(policy).not.toMatch(/script-src[^;]*unsafe-eval/);
  });

  it('submits no forms anywhere', () => {
    expect(policy).toContain("form-action 'none'");
  });
});

describe('every band page', () => {
  it.each(BANDS.map((b) => [b.title, b] as const))('%s carries the policy', (_title, band) => {
    const html = render(band);
    expect(html).toContain('http-equiv="Content-Security-Policy"');
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("connect-src 'none'");
  });

  it.each(BANDS.map((b) => [b.title, b] as const))('%s fills every placeholder', (_title, band) => {
    const html = render(band);
    expect(html).not.toMatch(/\{\{[a-zA-Z]+\}\}/);
    expect(html).toContain(band.title);
    expect(html).toContain(band.blurb);
    expect(html).toContain(`data-band="${band.id}"`);
  });

  it.each(BANDS.map((b) => [b.title, b] as const))('%s names the one script by nonce', (_title, band) => {
    expect(render(band)).toContain(`<script nonce="${NONCE}" src="${CSP_SOURCE}/media/band.js"></script>`);
  });
});

describe('what the page is not', () => {
  const html = render();

  it('carries no origin of its own', () => {
    // Everything absolute in the rendered page is the editor's own webview origin.
    for (const url of html.match(/\bhttps?:\/\/[^\s"'<>]+/g) ?? []) {
      expect(url.startsWith(CSP_SOURCE)).toBe(true);
    }
  });

  it('carries no credential', () => {
    expect(html).not.toMatch(/\b(?:access_token|refresh_token|client_secret|Bearer\s+\S)/);
    expect(SCRIPT).not.toMatch(/\b(?:access_token|refresh_token|client_secret|Bearer\s+\S)/);
  });

  it('offers the sign-in as a button, and there is no link anywhere on it', () => {
    expect(html).toContain('id="signin-button"');
    expect(html).not.toMatch(/<a\s/i);
  });

  it('has an unfilled placeholder left alone rather than blanked', () => {
    expect(renderBandPage('{{nothingKnown}}', {
      band: BANDS[0]!,
      cspSource: CSP_SOURCE,
      styleUri: '',
      scriptUri: '',
      nonce: NONCE,
    })).toBe('{{nothingKnown}}');
  });
});
