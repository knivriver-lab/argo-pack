/**
 * "Propose as OIP" — the one thing in this pack that reaches out and changes something.
 *
 * C5 says an open question is still standing. It never fails a unit for having one, because a
 * document that admits what it does not know is behaving correctly. What it could not do at P0
 * was help: the question sat in the front matter and the next move was somebody's to remember.
 *
 * This is that next move, and it is deliberately the *only* effect in the pack. The plank does
 * not decide anything. It takes a question that is already written down, hands it to the
 * fabric's `propose` tool, and tells the operator what came back. The proposal is a proposal:
 * whatever the fabric does with it is the fabric's business and somebody's decision.
 *
 * Nothing here imports an editor API, and the caller is injected, so the grant this plank now
 * holds is exercised in a test against a mock rather than described in a README.
 */

import type { McpCaller, McpResult } from './mcp.js';
import type { FrontMatter } from './front-matter.js';

/**
 * The single tool this plank consumes.
 *
 * It is named here, once, as a string — which is also what makes the grant in `plank.yaml`
 * legible to `pack-lint`. Delete the code and the lint fails the manifest as a dead grant;
 * delete the grant and the manifest stops describing the plank. The two cannot drift apart
 * quietly, which is the entire point of writing grants down.
 */
export const PROPOSE_TOOL = 'propose';

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim() !== '');
}

/** The open questions in a unit document, in the order they were written. */
export function openQuestionsOf(fm: FrontMatter): string[] {
  if (!isObject(fm.value)) return [];
  return stringList(fm.value['open_questions']).map((q) => q.trim());
}

export interface Proposal {
  /** The unit the question came out of. */
  readonly unit: string;
  /** Path of the document, relative to the workspace — where a reader goes to see the context. */
  readonly source: string;
  readonly question: string;
  readonly title: string;
}

export function draftProposal(unit: string, source: string, question: string): Proposal {
  return {
    unit,
    source,
    question,
    title: `${unit}: ${question}`,
  };
}

/** The title a code action shows. Long questions are elided rather than wrapped into the menu. */
export function actionTitle(question: string, limit = 60): string {
  const one = question.replace(/\s+/g, ' ').trim();
  const shown = one.length <= limit ? one : `${one.slice(0, limit - 1)}…`;
  return `Propose “${shown}” as an OIP`;
}

/**
 * Hand the proposal to the fabric.
 *
 * `caller` is `null` when there is no session, and that is not an error condition to be reported
 * from in here — it is the plank being inert, which is what it should be. The editor half turns
 * it into an offer to sign in.
 */
export async function proposeOpenQuestion(caller: McpCaller | null, proposal: Proposal): Promise<McpResult | null> {
  if (caller === null) return null;
  return caller.callTool(PROPOSE_TOOL, {
    unit: proposal.unit,
    source: proposal.source,
    question: proposal.question,
    title: proposal.title,
  });
}
