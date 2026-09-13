/**
 * The law, as five checks over a unit document's front matter.
 *
 * Nothing in this file imports `vscode`. It takes a document and a description of the workspace
 * around it, and returns findings with positions. That is what makes the rules testable without
 * an editor, and it is why the editor half of the plank is thirty lines of adapter.
 *
 * The checks:
 *
 *   schema  the front matter against the WORKSPACE's own `docs/schema/unit.schema.json`, read at
 *           runtime. No copy of any schema ships in this extension. If the workspace has no
 *           schema, or has one this validator cannot fully honour, that is reported as unknown —
 *           never as a pass.
 *   C6      the join closes: every id under `deps` resolves to a document in `docs/units`, and
 *           every one of those edges is also written down in `docs/deps.toml`.
 *   C7      the human words the declared pathway requires are present. A pathway is a promise
 *           about where a person gets a say; the words are where they say it.
 *   C8      a unit at or above the W1 threshold carries a `design_ref` and at least one
 *           deliverable. Below it, neither is required — small work should stay small.
 *   C5      open questions are still standing. Informational, never a failure: a unit that
 *           admits what it does not know is behaving correctly.
 */

import { validate, type ValidationError } from './json-schema.js';
import { hasEdge, type DepsTable } from './deps-toml.js';
import type { FrontMatter } from './front-matter.js';
import type { Pos } from './yaml-lite.js';

export type LawCode = 'schema' | 'schema-unknown' | 'C5' | 'C6' | 'C7' | 'C8' | 'front-matter';

export type LawSeverity = 'error' | 'warning' | 'information';

/**
 * The pathway table.
 *
 * P0 keeps it as a constant, because a table of four entries that changes twice a year is
 * clearer read than loaded. P4 replaces this with `docs/pathways/` from the open workspace; the
 * rule below does not need to change when it does, only the source of this map.
 */
export const PATHWAY_HUMAN_WORDS: Readonly<Record<string, readonly string[]>> = {
  foundry: ['dispatch', 'land'],
  reviewed: ['land'],
  direct: [],
  wayfinder: ['hitl-resolve'],
};

/** Weights in order. C8 applies at `W1` and above. */
export const WEIGHTS = ['W0', 'W1', 'W2', 'W3'] as const;
export const C8_THRESHOLD = 'W1';

export interface LawFix {
  readonly title: string;
  readonly kind: 'add-deps-entry' | 'add-human-word' | 'insert-design-ref';
  /** For `add-deps-entry`. */
  readonly from?: string;
  readonly to?: string;
  /** For `add-human-word`. */
  readonly word?: string;
  /** For `insert-design-ref`: which of the two keys to write. */
  readonly missing?: readonly string[];
}

/**
 * The placeholder the `insert-design-ref` action writes, and which C8 goes on counting as
 * missing. The action is there to save typing, not to let a unit through.
 */
export const PLACEHOLDER = 'TODO';

function isPlaceholder(value: string): boolean {
  const s = value.trim();
  return s === '' || s.toUpperCase() === PLACEHOLDER || s.toUpperCase().startsWith(`${PLACEHOLDER}:`);
}

export interface LawFinding {
  readonly code: LawCode;
  readonly severity: LawSeverity;
  readonly message: string;
  /** Zero-based. */
  readonly line: number;
  readonly column: number;
  readonly endColumn: number;
  readonly fix?: LawFix;
}

export interface WorkspaceLaw {
  /** Parsed `docs/schema/unit.schema.json` from the open workspace, or `null` if absent. */
  readonly unitSchema: unknown;
  /** Where that schema was looked for, for the message when it is missing. */
  readonly unitSchemaPath: string;
  /** Unit id → the document it was found in, built from `docs/units/*.md`. */
  readonly unitIds: ReadonlySet<string>;
  /** Parsed `docs/deps.toml`, or `null` if absent. */
  readonly deps: DepsTable | null;
  readonly depsPath: string;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function positionOf(fm: FrontMatter, path: string): { line: number; column: number; endColumn: number } {
  const pos: Pos | undefined = fm.positions.get(path);
  if (pos !== undefined) return { line: pos.line, column: pos.col, endColumn: pos.endCol };
  // Fall back to the opening fence: the finding is about the block as a whole.
  const line = fm.range?.openLine ?? 0;
  return { line, column: 0, endColumn: 3 };
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** The id a unit document claims, or `null` when it does not claim one. */
export function unitIdOf(frontMatter: unknown): string | null {
  if (!isObject(frontMatter)) return null;
  const id = frontMatter['id'];
  return typeof id === 'string' && id !== '' ? id : null;
}

function schemaFindings(fm: FrontMatter, law: WorkspaceLaw): LawFinding[] {
  if (law.unitSchema === null || law.unitSchema === undefined) {
    const at = positionOf(fm, '');
    return [
      {
        code: 'schema-unknown',
        severity: 'information',
        message: `no ${law.unitSchemaPath} in this workspace, so the front matter was not validated — unknown, not clean. law-plank reads the workspace's own schema and never carries one.`,
        ...at,
      },
    ];
  }

  const errors: ValidationError[] = validate(fm.value, law.unitSchema);
  return errors.map((error) => {
    const at = positionOf(fm, error.path);
    if (error.unsupported === true) {
      return {
        code: 'schema-unknown' as const,
        severity: 'warning' as const,
        message: `${law.unitSchemaPath} uses something law-plank cannot check (${error.message}) — this part of the front matter is unknown, not clean`,
        ...at,
      };
    }
    return {
      code: 'schema' as const,
      severity: 'error' as const,
      message: error.path === '' ? error.message : `${error.path}: ${error.message}`,
      ...at,
    };
  });
}

function c6Findings(fm: FrontMatter, law: WorkspaceLaw, selfId: string | null): LawFinding[] {
  if (!isObject(fm.value)) return [];
  const deps = fm.value['deps'];
  if (!Array.isArray(deps)) return [];

  const findings: LawFinding[] = [];
  deps.forEach((dep, index) => {
    const at = positionOf(fm, `deps.${index}`);
    if (typeof dep !== 'string') return; // the schema has already said so

    if (!law.unitIds.has(dep)) {
      findings.push({
        code: 'C6',
        severity: 'error',
        message: `C6: \`${dep}\` does not resolve — no document in docs/units declares that id, so this dependency points at nothing`,
        ...at,
      });
      return;
    }

    if (selfId === null) return; // cannot name the edge without knowing this unit's own id

    if (law.deps === null) {
      findings.push({
        code: 'C6',
        severity: 'warning',
        message: `C6: the edge ${selfId} → ${dep} is not recorded — this workspace has no ${law.depsPath}`,
        ...at,
        fix: { title: `Record ${selfId} → ${dep} in ${law.depsPath}`, kind: 'add-deps-entry', from: selfId, to: dep },
      });
      return;
    }

    if (!hasEdge(law.deps, selfId, dep)) {
      findings.push({
        code: 'C6',
        severity: 'warning',
        message: `C6: \`${dep}\` is declared here but the edge ${selfId} → ${dep} is missing from ${law.depsPath} — the join has to close from both ends`,
        ...at,
        fix: { title: `Add the ${selfId} → ${dep} edge to ${law.depsPath}`, kind: 'add-deps-entry', from: selfId, to: dep },
      });
    }
  });

  return findings;
}

function c7Findings(fm: FrontMatter): LawFinding[] {
  if (!isObject(fm.value)) return [];
  const pathway = fm.value['pathway'];
  if (typeof pathway !== 'string') return [];

  const required = PATHWAY_HUMAN_WORDS[pathway];
  if (required === undefined) {
    const at = positionOf(fm, 'pathway');
    return [
      {
        code: 'C7',
        severity: 'error',
        message: `C7: pathway \`${pathway}\` is not one of ${Object.keys(PATHWAY_HUMAN_WORDS).join(', ')}, so law-plank cannot tell which human words it owes`,
        ...at,
      },
    ];
  }

  const present = new Set(stringList(fm.value['human_word']));
  const at = positionOf(fm, 'human_word' in fm.value ? 'human_word' : 'pathway');

  return required
    .filter((word) => !present.has(word))
    .map((word) => ({
      code: 'C7' as const,
      severity: 'warning' as const,
      message: `C7: the \`${pathway}\` pathway owes the human word \`${word}\` — that is where a person gets a say, and it is missing from human_word`,
      ...at,
      fix: { title: `Add the \`${word}\` human word`, kind: 'add-human-word' as const, word },
    }));
}

function c8Findings(fm: FrontMatter): LawFinding[] {
  if (!isObject(fm.value)) return [];
  const weight = fm.value['weight'];
  if (typeof weight !== 'string') return [];

  const index = (WEIGHTS as readonly string[]).indexOf(weight);
  const threshold = (WEIGHTS as readonly string[]).indexOf(C8_THRESHOLD);
  if (index === -1 || index < threshold) return [];

  const missing: string[] = [];
  const designRef = fm.value['design_ref'];
  if (typeof designRef !== 'string' || isPlaceholder(designRef)) missing.push('design_ref');
  if (stringList(fm.value['deliverables']).filter((d) => !isPlaceholder(d)).length === 0) {
    missing.push('deliverables');
  }
  if (missing.length === 0) return [];

  const at = positionOf(fm, 'weight');
  return [
    {
      code: 'C8',
      severity: 'warning',
      message: `C8: a ${weight} unit is at or above the ${C8_THRESHOLD} threshold and must say what it is building against and what it will hand over — ${missing.join(' and ')} ${missing.length === 1 ? 'is' : 'are'} missing or still a ${PLACEHOLDER}`,
      ...at,
      fix: { title: `Add ${missing.join(' and ')}`, kind: 'insert-design-ref', missing },
    },
  ];
}

function c5Findings(fm: FrontMatter): LawFinding[] {
  if (!isObject(fm.value)) return [];
  const questions = stringList(fm.value['open_questions']);
  if (questions.length === 0) return [];

  const at = positionOf(fm, 'open_questions');
  return [
    {
      code: 'C5',
      severity: 'information',
      message: `C5: ${questions.length} open question${questions.length === 1 ? '' : 's'} still standing — ${questions.map((q) => `“${q}”`).join('; ')}`,
      ...at,
    },
  ];
}

export function checkUnit(fm: FrontMatter, law: WorkspaceLaw): LawFinding[] {
  if (fm.range === null && fm.error === undefined) {
    return [
      {
        code: 'front-matter',
        severity: 'error',
        message: 'this document has no front matter — a unit opens with a `---` fenced block',
        line: 0,
        column: 0,
        endColumn: 3,
      },
    ];
  }
  if (fm.error !== undefined) {
    return [
      {
        code: 'front-matter',
        severity: 'error',
        message: `front matter could not be read: ${fm.error.message}`,
        line: fm.error.line,
        column: 0,
        endColumn: 80,
      },
    ];
  }

  const selfId = unitIdOf(fm.value);
  const findings = [
    ...schemaFindings(fm, law),
    ...c6Findings(fm, law, selfId),
    ...c7Findings(fm),
    ...c8Findings(fm),
    ...c5Findings(fm),
  ];
  findings.sort((a, b) => a.line - b.line || a.column - b.column);
  return findings;
}

/** What the status bar counts: things a person could go and fix. */
export function countToFix(findings: readonly LawFinding[]): number {
  return findings.filter((f) => f.severity !== 'information').length;
}
