/**
 * The webview rules.
 *
 * A band webview is handed rows by the extension host. It holds no credential, it names no host,
 * and it opens no connection of its own. That arrangement is the entire security argument for
 * the served bands — the extension host does the authenticated fetch, so the page never has a
 * reason to hold a bearer — and an argument that nothing checks is a comment.
 *
 * These rules check it. A webview asset that gains a token, a host literal, a request or a
 * navigation fails the lint, and it fails at the point the file is written rather than at the
 * point somebody reads the compiled bundle and wonders.
 *
 * **What counts as a webview asset.** Everything under a plank's `media/` directory. That is
 * where a webview's `localResourceRoots` points in this pack, so it is exactly the set of files
 * a webview can load, and there is no second place for one to hide.
 *
 * The patterns are written out here, in the file that defines them, the same way the
 * private-reference patterns are. A webview asset that spelled the forbidden APIs out in a
 * comment would be arguing with its own lint, so the assets do not, and this file does.
 */

export interface WebviewRule {
  readonly id: string;
  readonly description: string;
  readonly regex: RegExp;
  /** Why this is forbidden, in the words the finding should carry. */
  readonly because: string;
}

/**
 * Credentials, and the things that carry them.
 *
 * The identifiers are matched in the shapes code uses them in — as a key, a property or a header
 * — rather than as bare words, so that a page may still say the word "token" in a sentence about
 * theme tokens. What it may not do is have one.
 */
const CREDENTIAL_RULES: readonly WebviewRule[] = [
  {
    id: 'token',
    description: 'a credential identifier',
    regex: /\b(?:access_token|refresh_token|id_token|client_secret|code_verifier|bearerToken|accessToken)\b/g,
    because:
      'the extension host holds the bearer and does the fetch; a webview that names a credential is a webview that has one',
  },
  {
    id: 'authorization-header',
    description: 'an Authorization header being set',
    regex: /(?:^|[^a-z-])authorization\s*['"]?\s*[:=]/gi,
    because: 'the Authorization header belongs on the extension host’s request, not on anything a page makes',
  },
  {
    id: 'bearer-literal',
    description: 'a literal bearer credential',
    // `Bearer ` followed by something that is not the end of a sentence.
    regex: /\bBearer\s+[A-Za-z0-9._~+/-]{8,}/g,
    because: 'a token in a webview asset is a token in whatever that page ends up rendering',
  },
  {
    id: 'jwt-literal',
    description: 'a JWT',
    regex: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\b/g,
    because: 'a token in a webview asset is a token in whatever that page ends up rendering',
  },
];

/**
 * Hosts.
 *
 * A webview asset gets its style and script URIs from the extension host, as `vscode-webview:`
 * URLs the editor minted. An absolute `http` or `https` URL in one of these files is either a
 * host somebody wrote down — which this public pack does not do — or a request waiting to
 * happen. `http-equiv` and the XML namespace an SVG needs are the two shapes that are not.
 */
const HOST_RULES: readonly WebviewRule[] = [
  {
    id: 'host-literal',
    description: 'an absolute http(s) URL',
    regex: /\bhttps?:\/\/[^\s'"<>)]+/g,
    because:
      'a band reads the origin the operator configured, through the extension host — argo-pack is public and names no host of anyone’s',
  },
];

/** URLs an asset may carry despite the rule above, because they address nothing. */
const HOST_ALLOW: readonly RegExp[] = [
  // The SVG and XHTML namespaces. Both are identifiers; neither is fetched.
  /^https?:\/\/www\.w3\.org\//,
];

/**
 * Requests and navigations.
 *
 * `acquireVsCodeApi` and `postMessage` are the bridge. Everything below is a second way out, and
 * a second way out is the thing binding 6 exists to forbid: the webview never talks to the
 * fabric directly, and it never sends the operator somewhere either. A 401 is an affordance in
 * the view, not a redirect.
 */
const REACH_RULES: readonly WebviewRule[] = [
  {
    id: 'direct-fetch',
    description: 'a request the page makes itself',
    regex:
      /\b(?:fetch\s*\(|new\s+XMLHttpRequest|new\s+WebSocket|new\s+EventSource|navigator\s*\.\s*sendBeacon|importScripts\s*\()/g,
    because:
      'the extension host does the authenticated fetch and posts the answer in; a page that can fetch is a page that needs a credential',
  },
  {
    id: 'navigation',
    description: 'a navigation the page performs',
    regex: /\b(?:window\s*\.\s*open\s*\(|location\s*\.\s*(?:href|assign|replace)\s*[=(]|document\s*\.\s*location\s*=)/g,
    because: 'signing in is a message to the extension host, not a redirect — a page that can navigate can navigate anywhere',
  },
  {
    id: 'unsafe-render',
    description: 'HTML assembled from data',
    regex: /\b(?:innerHTML|outerHTML|insertAdjacentHTML|document\s*\.\s*write)\b/g,
    because: 'rows arrive as strings and are painted with textContent; a band renders data, it does not evaluate it',
  },
];

export const WEBVIEW_RULES: readonly WebviewRule[] = [...CREDENTIAL_RULES, ...HOST_RULES, ...REACH_RULES];

/** Files that define these rules necessarily contain the patterns. */
export const WEBVIEW_RULE_DEFINITION_FILES: readonly string[] = ['packages/pack-lint/src/webview-guard.ts'];

/** The extensions a webview can actually load. A `.md` beside them is documentation, not payload. */
export const WEBVIEW_ASSET_EXTENSIONS: readonly string[] = ['.html', '.htm', '.js', '.mjs', '.css', '.svg'];

export function isWebviewAsset(path: string): boolean {
  if (!/(^|\/)packages\/[^/]+\/media\//.test(`/${path}`)) return false;
  return WEBVIEW_ASSET_EXTENSIONS.some((ext) => path.toLowerCase().endsWith(ext));
}

export interface WebviewHit {
  readonly ruleId: string;
  readonly description: string;
  readonly because: string;
  readonly line: number;
  readonly column: number;
  readonly match: string;
}

function allowedHost(match: string): boolean {
  return HOST_ALLOW.some((allow) => allow.test(match));
}

export function scanWebviewAsset(text: string): WebviewHit[] {
  const hits: WebviewHit[] = [];

  text.split('\n').forEach((line, index) => {
    for (const rule of WEBVIEW_RULES) {
      rule.regex.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = rule.regex.exec(line)) !== null) {
        const match = m[0];
        if (match === '') {
          rule.regex.lastIndex++;
          continue;
        }
        if (rule.id === 'host-literal' && allowedHost(match)) continue;
        hits.push({
          ruleId: rule.id,
          description: rule.description,
          because: rule.because,
          line: index + 1,
          column: m.index + 1,
          match,
        });
      }
    }
  });

  return hits.sort((a, b) => a.line - b.line || a.column - b.column);
}

/**
 * Every webview page states a policy, and the policy starts by refusing everything.
 *
 * Checked separately from the patterns above because it is an absence rather than a presence: a
 * page with no `Content-Security-Policy` has not broken a rule, it has failed to make a promise.
 */
export interface CspProblem {
  readonly line: number;
  readonly message: string;
}

const CSP_META = /<meta\s+[^>]*http-equiv\s*=\s*["']Content-Security-Policy["'][^>]*>/i;

export function checkContentSecurityPolicy(html: string): CspProblem[] {
  const match = CSP_META.exec(html);
  if (match === null) {
    return [
      {
        line: 1,
        message:
          'no Content-Security-Policy meta element — a webview page states its policy in the page, and a page with none is trusting whatever it is handed',
      },
    ];
  }

  const line = html.slice(0, match.index).split('\n').length;
  // The attribute is read to its own closing quote. A policy is full of `'none'`, so stopping at
  // the first quote of either kind would truncate every policy worth having.
  const attribute = /content\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(match[0]);
  const content = attribute?.[1] ?? attribute?.[2] ?? '';

  // The policy is templated at render time; the template carries the placeholder, and `page.ts`
  // is what fills it. Either the placeholder or the literal clause is a promise kept.
  const stated = content.includes('{{csp}}') || /default-src\s+'none'/.test(content);
  if (!stated) {
    return [
      {
        line,
        message: `the Content-Security-Policy does not start from \`default-src 'none'\` — a policy that permits by default is a policy that will permit something nobody chose (found ${JSON.stringify(content)})`,
      },
    ];
  }
  return [];
}
