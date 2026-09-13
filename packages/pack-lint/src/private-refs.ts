/**
 * The private-reference rules.
 *
 * argo-pack is public. Nothing in the tree may name a host, an address, an operator's home
 * directory or an internal deployment. These patterns are the same ones `.gitleaks.toml`
 * carries; they live here as well so `npm run lint` catches them without a gitleaks binary
 * present. Keep the two in step.
 *
 * The patterns are shapes, not a list of names. A public repository must not carry the list of
 * things it is trying not to mention — writing the names down would be the leak. Deployments
 * that want extra literal terms checked pass them in `PACK_LINT_DENY` (comma-separated) from a
 * private environment, and the lint honours them without ever recording them here.
 */

export interface PrivateRefRule {
  readonly id: string;
  readonly description: string;
  readonly regex: RegExp;
  readonly allow?: readonly RegExp[];
}

export const PRIVATE_REF_RULES: readonly PrivateRefRule[] = [
  {
    id: 'private-ipv4',
    description: 'IPv4 literal',
    // The lookarounds keep a six-component version string from reading as an address.
    regex:
      /(?<![0-9.])(?:(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])(?![0-9.])/g,
    allow: [
      /^0\.0\.0\.0$/,
      /^127\.0\.0\.1$/,
      /^255\.255\.255\.255$/,
      // RFC 5737 documentation ranges are the only addresses that may be written down.
      /^192\.0\.2\.\d{1,3}$/,
      /^198\.51\.100\.\d{1,3}$/,
      /^203\.0\.113\.\d{1,3}$/,
    ],
  },
  {
    id: 'private-ipv6',
    description: 'IPv6 literal',
    regex: /\b(?:[0-9a-f]{1,4}:){4,7}[0-9a-f]{1,4}\b/gi,
  },
  {
    id: 'internal-hostname',
    description: 'hostname in an internal or link-local zone',
    regex:
      /\b[a-z0-9][a-z0-9-]{0,62}\.(?:lan|local|internal|intranet|home|corp|localdomain|in-addr\.arpa|ip6\.arpa)\b/gi,
  },
  {
    id: 'mesh-hostname',
    description: 'hostname in an overlay or tunnel namespace',
    regex: /\b[a-z0-9][a-z0-9-]{0,62}\.(?:ts\.net|onion|tailnet|wg)\b/gi,
  },
  {
    id: 'home-path',
    description: "home-directory path (leaks an operator's username or machine layout)",
    regex: /(?:~\/[A-Za-z0-9._-]|\/home\/[A-Za-z0-9._-]+\/|\/Users\/[A-Za-z0-9._-]+\/|\/root\/[A-Za-z0-9._-])/g,
    allow: [/^\/home\/<user>\/$/, /^\/Users\/<user>\/$/],
  },
  {
    id: 'ssh-target',
    description: 'ssh, scp or rsync invocation naming a concrete host',
    regex: /\b(?:ssh|scp|rsync)\s+(?:-\S+\s+)*[a-z0-9._-]+@[a-z0-9._-]+/gi,
  },
];

/** Files that define the rules necessarily contain the patterns. Nothing else is exempt. */
export const RULE_DEFINITION_FILES: readonly string[] = [
  '.gitleaks.toml',
  'packages/pack-lint/src/private-refs.ts',
];

export interface PrivateRefHit {
  readonly ruleId: string;
  readonly description: string;
  readonly line: number;
  readonly column: number;
  readonly match: string;
}

/** Extra literal terms supplied by a private environment; never recorded in the tree. */
export function extraDenyTerms(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env['PACK_LINT_DENY'] ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

export function scanPrivateRefs(text: string, extraTerms: readonly string[] = []): PrivateRefHit[] {
  const hits: PrivateRefHit[] = [];
  const lines = text.split('\n');

  lines.forEach((line, index) => {
    for (const rule of PRIVATE_REF_RULES) {
      rule.regex.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = rule.regex.exec(line)) !== null) {
        const match = m[0];
        if (match === '') {
          rule.regex.lastIndex++;
          continue;
        }
        if (rule.allow?.some((a) => a.test(match))) continue;
        hits.push({
          ruleId: rule.id,
          description: rule.description,
          line: index + 1,
          column: m.index + 1,
          match,
        });
      }
    }
    for (const term of extraTerms) {
      const lower = line.toLowerCase();
      let from = 0;
      for (;;) {
        const at = lower.indexOf(term.toLowerCase(), from);
        if (at === -1) break;
        hits.push({
          ruleId: 'deny-term',
          description: 'term supplied via PACK_LINT_DENY',
          line: index + 1,
          column: at + 1,
          // Do not echo the term back into logs that may themselves be public.
          match: `<redacted, ${term.length} chars>`,
        });
        from = at + term.length;
      }
    }
  });

  return hits;
}
