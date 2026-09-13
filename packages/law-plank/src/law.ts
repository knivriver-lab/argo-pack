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
 *   C7      the declared pathway is one the workspace has written down in `docs/pathways/`, and
 *           every human word the unit claims is an approval that pathway actually offers. A
 *           pathway is a promise about where a person gets a say; the words are where they say
 *           it, and a unit cannot claim a say its pathway does not give.
 *   C8      a unit at or above the W1 threshold carries a `design_ref` and at least one
 *           deliverable. Below it, neither is required — small work should stay small.
 *   C5      open questions are still standing. Informational, never a failure: a unit that
 *           admits what it does not know is behaving correctly.
 */

import { validate, type ValidationError } from './json-schema.js';
import { hasEdge, type DepsTable } from './deps-toml.js';
import type { FrontMatter } from './front-matter.js';
import type { PathwayDeclaration } from './pathway.js';
import {
  inReadingOrder,
  isObject,
  positionOf,
  stringList,
  type LawFinding,
} from './finding.js';

export {
  countToFix,
  type LawCode,
  type LawFinding,
  type LawFix,
  type LawFixKind,
  type LawSeverity,
} from './finding.js';

/** Weights in order. C8 applies at `W1` and above. */
export const WEIGHTS = ['W0', 'W1', 'W2', 'W3'] as const;
export const C8_THRESHOLD = 'W1';

/**
 * The placeholder the `insert-design-ref` action writes, and which C8 goes on counting as
 * missing. The action is there to save typing, not to let a unit through.
 */
export const PLACEHOLDER = 'TODO';

function isPlaceholder(value: string): boolean {
  const s = value.trim();
  return s === '' || s.toUpperCase() === PLACEHOLDER || s.toUpperCase().startsWith(`${PLACEHOLDER}:`);
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
  /**
   * Pathway id → the declaration it was read from, built from `docs/pathways/*.toml`. `null`
   * means the workspace has no such directory at all, which C7 reports as unknown rather than
   * quietly accepting whatever a unit happens to name.
   */
  readonly pathways: ReadonlyMap<string, PathwayDeclaration> | null;
  readonly pathwaysDir: string;
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

/**
 * C7 — the pathway is declared, and the human words are ones it offers.
 *
 * Until P4 this rule read a table of four pathways held as a constant in this file. It does not
 * any more: the pathways come from `docs/pathways/*.toml` in the open workspace, the same way
 * every other input to this plank does. The table is gone, not moved.
 *
 * That changes the direction of the check, and the change is the point. A constant table could
 * only say what a pathway *owes*; a declaration says what it *offers*, in its `approvals`. So:
 *
 *   - a `pathway` the workspace has not declared is an ERROR, and it is the plank's own refusal
 *     rather than a schema's. A unit may not run on a pathway nobody has written down, whatever
 *     any enum happens to permit.
 *   - a `human_word` outside that pathway's `approvals` is an ERROR: the unit is claiming a
 *     person gets a say at a point the pathway does not give one.
 *   - a unit that claims no human words at all, on a pathway that offers some, is a WARNING with
 *     a fix per approval. It is not an error — a unit may legitimately use fewer of the says a
 *     pathway offers than all of them — but a unit using none of them is nearly always an
 *     oversight, and this is the one shape of it worth pointing at.
 */
function c7Findings(fm: FrontMatter, law: WorkspaceLaw): LawFinding[] {
  if (!isObject(fm.value)) return [];
  const value = fm.value;
  const pathway = value['pathway'];
  if (typeof pathway !== 'string') return [];

  const pathwayAt = positionOf(fm, 'pathway');

  if (law.pathways === null) {
    return [
      {
        code: 'C7',
        severity: 'information',
        message: `C7: this workspace has no ${law.pathwaysDir}/, so what the \`${pathway}\` pathway offers is unknown — not clean, and not something law-plank will guess at`,
        ...pathwayAt,
      },
    ];
  }

  const declaration = law.pathways.get(pathway);
  if (declaration === undefined) {
    const declared = [...law.pathways.keys()].sort();
    return [
      {
        code: 'C7',
        severity: 'error',
        message: `C7: pathway \`${pathway}\` is not declared — no file in ${law.pathwaysDir}/ declares that id${declared.length === 0 ? '' : ` (there are ${declared.map((d) => `\`${d}\``).join(', ')})`}. A unit may not run on a pathway the workspace has not written down.`,
        ...pathwayAt,
      },
    ];
  }

  const approvals = declaration.approvals;
  const offered = new Set(approvals);
  const claimed = stringList(value['human_word']);

  if (claimed.length === 0) {
    if (approvals.length === 0) return [];
    const at = positionOf(fm, 'human_word' in value ? 'human_word' : 'pathway');
    return approvals.map((word) => ({
      code: 'C7' as const,
      severity: 'warning' as const,
      message: `C7: the \`${pathway}\` pathway offers the human word \`${word}\` and this unit claims none at all — that is where a person gets a say, and ${declaration.file} says there is one to be had`,
      ...at,
      fix: { title: `Add the \`${word}\` human word`, kind: 'add-human-word' as const, word },
    }));
  }

  return claimed
    .map((word, index) => ({ word, index }))
    .filter(({ word }) => !offered.has(word))
    .map(({ word, index }) => ({
      code: 'C7' as const,
      severity: 'error' as const,
      message: `C7: the \`${pathway}\` pathway offers no approval \`${word}\` — ${declaration.file} declares ${approvals.length === 0 ? 'none at all' : approvals.map((a) => `\`${a}\``).join(', ')}, and a unit cannot claim a say its pathway does not give`,
      ...positionOf(fm, `human_word.${index}`),
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
  return inReadingOrder([
    ...schemaFindings(fm, law),
    ...c6Findings(fm, law, selfId),
    ...c7Findings(fm, law),
    ...c8Findings(fm),
    ...c5Findings(fm),
  ]);
}
