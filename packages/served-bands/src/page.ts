/**
 * The band page, assembled from the template in `media/`.
 *
 * Pure on purpose: it takes the template text and four strings and returns HTML, so the content
 * security policy this plank actually ships can be asserted in a test rather than described in a
 * comment.
 *
 * The policy is the narrow one. `default-src 'none'` means everything is refused unless it is
 * named, and the only things named are the editor's own `cspSource` for styles and the one
 * nonce for the one script. `connect-src 'none'` is stated even though `default-src` already
 * covers it, because it is the clause that says the thing this plank is for: a band webview does
 * not talk to the fabric. The host does, and hands the answer over.
 */

import type { Band } from './bands.js';

export interface PageParts {
  readonly band: Band;
  /** `webview.cspSource` — the `vscode-webview:` origin the editor serves this page's assets from. */
  readonly cspSource: string;
  readonly styleUri: string;
  readonly scriptUri: string;
  readonly nonce: string;
}

export function contentSecurityPolicy(cspSource: string, nonce: string): string {
  return [
    "default-src 'none'",
    `style-src ${cspSource}`,
    `script-src 'nonce-${nonce}'`,
    `img-src ${cspSource}`,
    `font-src ${cspSource}`,
    // Said out loud: this page makes no requests of its own, to the fabric or to anywhere.
    "connect-src 'none'",
    "form-action 'none'",
  ].join('; ');
}

export function renderBandPage(template: string, parts: PageParts): string {
  const csp = contentSecurityPolicy(parts.cspSource, parts.nonce);
  const replacements: Record<string, string> = {
    csp,
    nonce: parts.nonce,
    style: parts.styleUri,
    script: parts.scriptUri,
    bandId: parts.band.id,
    title: parts.band.title,
    blurb: parts.band.blurb,
  };

  return template.replace(/\{\{([a-zA-Z]+)\}\}/g, (whole, key: string) => replacements[key] ?? whole);
}
