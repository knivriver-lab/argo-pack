/**
 * What each code action actually writes.
 *
 * Every fix in this plank is one `WorkspaceEdit` and nothing else. No shell, no task, no command
 * that runs something afterwards, no multi-step orchestration you have to trust. That is a hard
 * rule (`terminal: NEVER-DECLARED`), and keeping the edits pure and in this file is how it stays
 * checkable: `extension.ts` turns what comes back from here into a `WorkspaceEdit` and applies
 * it, and has no other way to change anything.
 */

import type { FrontMatter } from './front-matter.js';
import type { LawFix } from './finding.js';
import { PLACEHOLDER } from './law.js';
import { renderEdge } from './deps-toml.js';

export interface PlainEdit {
  /** Zero-based, end-exclusive, as a text range. */
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
  readonly newText: string;
}

/**
 * An edit to the document being looked at — a unit document or a ticket. Both open with the same
 * fenced front-matter block, and every fix in this file writes inside it.
 */
export interface DocumentFix {
  readonly target: 'document';
  readonly edit: PlainEdit;
}

/** An edit to the workspace's `docs/deps.toml`, which may not exist yet. */
export interface DepsFix {
  readonly target: 'deps';
  /** Full contents to write. The caller creates the file if it is absent. */
  readonly contents: string;
  readonly createdFile: boolean;
}

export type ResolvedFix = DocumentFix | DepsFix;

const DEPS_HEADER = `# The dependency edges, written down once so the graph can be read without
# opening every unit. C6 holds this file and the units' own front matter in agreement.
`;

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/** Insert a block of lines immediately before the closing \`---\` fence. */
function insertBeforeFence(fm: FrontMatter, block: string): DocumentFix | null {
  if (fm.range === null) return null;
  const line = fm.range.closeLine;
  return {
    target: 'document',
    edit: { startLine: line, startColumn: 0, endLine: line, endColumn: 0, newText: block },
  };
}

export function resolveAddHumanWord(text: string, fm: FrontMatter, word: string): DocumentFix | null {
  const lines = text.split('\n');
  const keyPos = fm.positions.get('human_word');

  if (keyPos === undefined) {
    return insertBeforeFence(fm, `human_word:\n  - ${word}\n`);
  }

  const keyLine = lines[keyPos.line];
  if (keyLine === undefined) return null;
  const afterColon = keyLine.slice(keyLine.indexOf(':') + 1);

  // `human_word: [dispatch]` — a flow sequence on the key's own line.
  if (afterColon.trim().startsWith('[')) {
    const close = keyLine.lastIndexOf(']');
    if (close === -1) return null;
    const open = keyLine.indexOf('[');
    const inner = keyLine.slice(open + 1, close).trim();
    const replacement = inner === '' ? word : `${inner}, ${word}`;
    return {
      target: 'document',
      edit: {
        startLine: keyPos.line,
        startColumn: open + 1,
        endLine: keyPos.line,
        endColumn: close,
        newText: replacement,
      },
    };
  }

  // A block sequence: append after the last item that belongs to it.
  let lastItemLine = -1;
  let itemIndent = indentOf(keyLine) + 2;
  for (let i = 0; ; i++) {
    const itemPos = fm.positions.get(`human_word.${i}`);
    if (itemPos === undefined) break;
    lastItemLine = itemPos.line;
    itemIndent = itemPos.col;
  }

  if (lastItemLine === -1) {
    // `human_word:` with nothing under it.
    return {
      target: 'document',
      edit: {
        startLine: keyPos.line + 1,
        startColumn: 0,
        endLine: keyPos.line + 1,
        endColumn: 0,
        newText: `${' '.repeat(itemIndent)}- ${word}\n`,
      },
    };
  }

  return {
    target: 'document',
    edit: {
      startLine: lastItemLine + 1,
      startColumn: 0,
      endLine: lastItemLine + 1,
      endColumn: 0,
      newText: `${' '.repeat(itemIndent)}- ${word}\n`,
    },
  };
}

export function resolveInsertDesignRef(fm: FrontMatter, missing: readonly string[]): DocumentFix | null {
  const parts: string[] = [];
  if (missing.includes('design_ref')) {
    parts.push(`design_ref: ${PLACEHOLDER}  # what this unit is being built against\n`);
  }
  if (missing.includes('deliverables')) {
    parts.push(`deliverables:\n  - ${PLACEHOLDER}  # what it hands over\n`);
  }
  if (parts.length === 0) return null;
  return insertBeforeFence(fm, parts.join(''));
}

/**
 * The two ticket skeletons.
 *
 * Both write keys with a `TODO` beside them, and both are exactly as much help as the design_ref
 * skeleton is: they save typing the field names out. Neither satisfies the rule that produced
 * them — T2 goes on wanting a resolution that says something, T3 goes on wanting a claim that
 * names somebody — because a fix that got a ticket past a check would be worse than no fix.
 *
 * The field names are passed in. They come from the workspace's own ticket schema, which is the
 * only thing that knows what a resolution or a claim is made of here.
 */
export function resolveInsertResolutionSkeleton(
  fm: FrontMatter,
  fields: readonly string[],
): DocumentFix | null {
  if (fields.length === 0) return null;
  const body = fields.map((field) => `  ${field}: ${PLACEHOLDER}\n`).join('');
  return insertBeforeFence(fm, `resolution:\n${body}`);
}

export function resolveInsertClaimBlock(fm: FrontMatter, fields: readonly string[]): DocumentFix | null {
  if (fields.length === 0) return null;
  return insertBeforeFence(fm, fields.map((field) => `${field}: ${PLACEHOLDER}\n`).join(''));
}

export function resolveAddDepsEntry(depsText: string | null, from: string, to: string): DepsFix {
  if (depsText === null) {
    return { target: 'deps', contents: DEPS_HEADER + renderEdge(from, to), createdFile: true };
  }
  const body = depsText.endsWith('\n') ? depsText : `${depsText}\n`;
  return { target: 'deps', contents: body + renderEdge(from, to), createdFile: false };
}

/**
 * Turn a fix descriptor into the edit it stands for.
 *
 * `depsText` is the current contents of `docs/deps.toml`, or `null` when the workspace has none.
 */
export function resolveFix(
  fix: LawFix,
  text: string,
  fm: FrontMatter,
  depsText: string | null,
): ResolvedFix | null {
  switch (fix.kind) {
    case 'add-human-word':
      return fix.word === undefined ? null : resolveAddHumanWord(text, fm, fix.word);
    case 'insert-design-ref':
      return resolveInsertDesignRef(fm, fix.missing ?? ['design_ref', 'deliverables']);
    case 'add-deps-entry':
      return fix.from === undefined || fix.to === undefined
        ? null
        : resolveAddDepsEntry(depsText, fix.from, fix.to);
    case 'insert-resolution-skeleton':
      return fix.fields === undefined ? null : resolveInsertResolutionSkeleton(fm, fix.fields);
    case 'insert-claim-block':
      return fix.fields === undefined ? null : resolveInsertClaimBlock(fm, fix.fields);
    default:
      return null;
  }
}
