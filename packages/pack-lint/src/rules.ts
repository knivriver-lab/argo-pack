/**
 * The manifest rules.
 *
 * Schema conformance is necessary but not sufficient. A manifest is a set of claims about a
 * plank, and three of those claims can only be checked against the plank's own source:
 *
 *   - a `keel` outside the published set means the manifest is describing a world the pack does
 *     not publish, so no reader can tell what its assumptions are worth;
 *   - an `upstream` outside the enum, or a declared extension point the plank never registers,
 *     means the manifest is not a map of the plank;
 *   - an MCP tool listed under `consumes` that the source never names is a **dead grant** — a
 *     permission held for no reason, which is exactly how a small tool stops being small.
 *
 * And `terminal` is checked on its own, loudly, because it is the promise the pack is for.
 */

import {
  AFFORDANCE_CLASSES,
  PUBLIC_KEELS,
  TERMINAL_DECLARATION,
  UPSTREAM_POINTS,
  validate,
  type Pos,
} from '@argo/schemas';

export type Severity = 'error';

export interface Finding {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly rule: string;
  readonly message: string;
  readonly severity: Severity;
}

export interface PlankSource {
  /** Path of the manifest, relative to the repository root. */
  readonly manifestPath: string;
  /** Parsed `plank.yaml`. */
  readonly manifest: unknown;
  /** Line positions from the YAML reader, keyed by dotted path. */
  readonly positions: ReadonlyMap<string, Pos>;
  /** Every source file of the plank, concatenated. Used to test declarations against reality. */
  readonly sourceText: string;
}

/**
 * Which source marker proves a plank really registers an upstream extension point. Only the
 * unambiguous ones are listed; a point with no entry here is not checked rather than guessed at.
 */
const UPSTREAM_MARKERS: Readonly<Record<string, readonly string[]>> = {
  diagnostics: ['createDiagnosticCollection'],
  'code-actions': ['registerCodeActionsProvider'],
  'session-provider': ['registerAuthenticationProvider'],
};

function at(positions: ReadonlyMap<string, Pos>, path: string): { line: number; column: number } {
  const pos = positions.get(path);
  return pos === undefined ? { line: 1, column: 1 } : { line: pos.line + 1, column: pos.col + 1 };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Does the source reference this MCP tool by name? Quoted, so that a tool called `read` is not
 * "referenced" by the word `read` in a comment.
 */
export function referencesToolName(sourceText: string, tool: string): boolean {
  const quoted = [`'${tool}'`, `"${tool}"`, '`' + tool + '`'];
  return quoted.some((q) => sourceText.includes(q));
}

export function lintManifest(plank: PlankSource, schema: unknown): Finding[] {
  const findings: Finding[] = [];
  const file = plank.manifestPath;
  const push = (rule: string, message: string, path: string): void => {
    const { line, column } = at(plank.positions, path);
    findings.push({ file, line, column, rule, message, severity: 'error' });
  };

  if (!isObject(plank.manifest)) {
    findings.push({
      file,
      line: 1,
      column: 1,
      rule: 'manifest/shape',
      message: 'manifest is not a YAML mapping',
      severity: 'error',
    });
    return findings;
  }
  const m = plank.manifest;

  for (const error of validate(m, schema)) {
    const { line, column } = at(plank.positions, error.path);
    findings.push({
      file,
      line,
      column,
      rule: error.unsupported === true ? 'schema/unsupported' : 'schema',
      message: error.path === '' ? error.message : `${error.path}: ${error.message}`,
      severity: 'error',
    });
  }

  // terminal — the promise the whole pack rests on, so it gets its own rule and its own words.
  if (m['terminal'] !== TERMINAL_DECLARATION) {
    push(
      'plank/terminal',
      `terminal must be ${TERMINAL_DECLARATION} — no plank in this pack runs a shell, and there is no flag that changes it (found ${JSON.stringify(m['terminal'])})`,
      'terminal',
    );
  }

  // keel — must be in the published set.
  const keel = m['keel'];
  if (typeof keel !== 'string' || !(PUBLIC_KEELS as readonly string[]).includes(keel)) {
    push(
      'plank/keel',
      `keel ${JSON.stringify(keel)} is not in the published set {${PUBLIC_KEELS.join(', ')}} — a plank may not invent a keel, because the keel is what tells a reader which workspaces its assumptions hold for`,
      'keel',
    );
  }

  const affordance = m['affordance_class'];
  if (typeof affordance !== 'string' || !(AFFORDANCE_CLASSES as readonly string[]).includes(affordance)) {
    push(
      'plank/affordance-class',
      `affordance_class ${JSON.stringify(affordance)} is not one of {${AFFORDANCE_CLASSES.join(', ')}}`,
      'affordance_class',
    );
  }

  // upstream — inside the enum, and actually registered.
  const upstream = m['upstream'];
  if (Array.isArray(upstream)) {
    upstream.forEach((point, index) => {
      if (typeof point !== 'string' || !(UPSTREAM_POINTS as readonly string[]).includes(point)) {
        push(
          'plank/upstream',
          `upstream ${JSON.stringify(point)} is outside the enum {${UPSTREAM_POINTS.join(', ')}}`,
          `upstream.${index}`,
        );
        return;
      }
      const markers = UPSTREAM_MARKERS[point];
      if (markers !== undefined && !markers.some((marker) => plank.sourceText.includes(marker))) {
        push(
          'plank/upstream-unused',
          `upstream declares ${JSON.stringify(point)} but no source file references ${markers.map((s) => `'${s}'`).join(' or ')} — declare the extension points the plank actually registers`,
          `upstream.${index}`,
        );
      }
    });
  }

  // consumes — no dead grants.
  const consumes = m['consumes'];
  if (isObject(consumes)) {
    const tools = consumes['mcp_tools'];
    if (Array.isArray(tools)) {
      tools.forEach((tool, index) => {
        if (typeof tool !== 'string') return;
        if (!referencesToolName(plank.sourceText, tool)) {
          push(
            'plank/dead-grant',
            `consumes.mcp_tools declares ${JSON.stringify(tool)} but no source file references it — a grant the plank does not use is a grant it should not hold`,
            `consumes.mcp_tools.${index}`,
          );
        }
      });
    }
    const streams = consumes['mcp_streams'];
    if (Array.isArray(streams)) {
      streams.forEach((stream, index) => {
        if (typeof stream !== 'string') return;
        if (!referencesToolName(plank.sourceText, stream)) {
          push(
            'plank/dead-grant',
            `consumes.mcp_streams declares ${JSON.stringify(stream)} but no source file references it — a grant the plank does not use is a grant it should not hold`,
            `consumes.mcp_streams.${index}`,
          );
        }
      });
    }
  }

  return findings;
}
