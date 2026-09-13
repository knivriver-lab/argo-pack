/**
 * What a finding is, and the three helpers every rule file needs to make one.
 *
 * The plank now reads four kinds of document out of the open workspace — unit documents,
 * tickets, pathway declarations and the assignment table — and each has its own rule file. They
 * all produce the same thing: a finding with a position, a severity and a sentence a person can
 * act on. That shared shape lives here so the rule files can stay independent of each other, and
 * so nothing in `law.ts`, `ticket.ts` or `pathway.ts` has to import either of the others.
 *
 * Nothing in this file imports `vscode`.
 */

import type { FrontMatter } from './front-matter.js';
import type { Pos } from './yaml-lite.js';

export type LawCode =
  /** Unit documents. */
  | 'schema'
  | 'schema-unknown'
  | 'C5'
  | 'C6'
  | 'C7'
  | 'C8'
  | 'front-matter'
  /** Tickets. */
  | 'ticket-schema'
  | 'ticket-schema-unknown'
  | 'T1'
  | 'T2'
  | 'T3'
  | 'T4'
  /** Pathway declarations and the assignment table. */
  | 'pathway-schema'
  | 'pathway-schema-unknown'
  | 'pathway-toml'
  | 'PW1'
  | 'PW2'
  | 'A1';

export type LawSeverity = 'error' | 'warning' | 'information';

export type LawFixKind =
  | 'add-deps-entry'
  | 'add-human-word'
  | 'insert-design-ref'
  | 'insert-resolution-skeleton'
  | 'insert-claim-block';

export interface LawFix {
  readonly title: string;
  readonly kind: LawFixKind;
  /** For `add-deps-entry`. */
  readonly from?: string;
  readonly to?: string;
  /** For `add-human-word`. */
  readonly word?: string;
  /** For `insert-design-ref`: which of the two keys to write. */
  readonly missing?: readonly string[];
  /**
   * For `insert-resolution-skeleton` and `insert-claim-block`: the field names to write. They
   * come from the workspace's own ticket schema, never from a list held in here — see `ticket.ts`.
   */
  readonly fields?: readonly string[];
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

/** A place in a document, in the form a finding wants it. */
export interface At {
  readonly line: number;
  readonly column: number;
  readonly endColumn: number;
}

export const START: At = { line: 0, column: 0, endColumn: 3 };

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** Where a dotted path sits in a front-matter block, falling back to the opening fence. */
export function positionOf(fm: FrontMatter, path: string): At {
  const pos: Pos | undefined = fm.positions.get(path);
  if (pos !== undefined) return { line: pos.line, column: pos.col, endColumn: pos.endCol };
  const line = fm.range?.openLine ?? 0;
  return { line, column: 0, endColumn: 3 };
}

/** Where a dotted path sits in a file the plank parsed itself, falling back to the first line. */
export function positionIn(positions: ReadonlyMap<string, Pos>, path: string): At {
  const pos = positions.get(path);
  if (pos === undefined) return START;
  return { line: pos.line, column: pos.col, endColumn: pos.endCol };
}

/** Findings, in the order a reader meets them. */
export function inReadingOrder(findings: LawFinding[]): LawFinding[] {
  findings.sort((a, b) => a.line - b.line || a.column - b.column);
  return findings;
}

/** What the status bar counts: things a person could go and fix. */
export function countToFix(findings: readonly LawFinding[]): number {
  return findings.filter((f) => f.severity !== 'information').length;
}
