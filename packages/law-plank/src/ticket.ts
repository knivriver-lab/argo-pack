/**
 * Tickets — `docs/map/tickets/*.md`.
 *
 * A ticket is a piece of work the map knows about: what it is, what it stands on, and — when it
 * is over — what was decided and what proves it. The front matter carries the record; the prose
 * below carries the two sections a person actually reads, `## Gist` and `## Resolution`.
 *
 * The division of labour here is the same one the rest of the plank keeps, and it is worth
 * saying plainly:
 *
 *   **the schema owns the shapes** — which fields exist, what they may contain, the closed
 *   vocabulary a `witness` is drawn from. All of that is read from the workspace's own
 *   `docs/schema/ticket.schema.json` at runtime. No copy of it ships here, and where the
 *   workspace has none, the verdict is unknown rather than clean.
 *
 *   **the plank owns what a schema cannot say** — the three rules below. Two of them are
 *   conditionals a schema could in principle express and most workspaces' do not; the first is
 *   something no schema can express at all.
 *
 * T1 is the writer rule, and it is the one to read twice. The witness vocabulary admits
 * `memory`, because a checkpoint tick may legitimately stand on it — somebody remembering, in
 * the moment, inside a conversation that is itself the record. A ticket is not that. A ticket
 * outlives the conversation it was written in, and a ticket whose witness is `memory` is a claim
 * with nothing behind it by the time anyone comes to check. The vocabulary is shared; the
 * admissibility is not, and only the writer knows which it is writing. So the rule lives here.
 *
 * Nothing in this file imports `vscode`.
 */

import { validate, type ValidationError } from './json-schema.js';
import { parseFrontMatter, type FrontMatter } from './front-matter.js';
import { isObject, inReadingOrder, positionOf, type LawFinding } from './finding.js';

/** The witness value that is admissible in a checkpoint tick and never in a ticket. */
export const INADMISSIBLE_WITNESS = 'memory';

/** The status values the two conditional rules hang off. */
export const RESOLVED = 'resolved';
export const CLAIMED = 'claimed';

export interface TicketLaw {
  /** Parsed `docs/schema/ticket.schema.json` from the open workspace, or `null` if absent. */
  readonly ticketSchema: unknown;
  readonly ticketSchemaPath: string;
}

export interface Section {
  readonly heading: string;
  /** Zero-based line of the `##` heading. */
  readonly line: number;
  /** Everything between this heading and the next one, trimmed. */
  readonly body: string;
}

export interface Ticket {
  readonly frontMatter: FrontMatter;
  readonly sections: ReadonlyMap<string, Section>;
  /** Zero-based line just past the end of the document. */
  readonly lineCount: number;
}

const HEADING = /^##\s+(.+?)\s*$/;

/** The `##` sections of a markdown document, keyed by heading. */
export function readSections(text: string): Map<string, Section> {
  const lines = text.split('\n');
  const sections = new Map<string, Section>();
  let open: { heading: string; line: number; from: number } | null = null;

  const close = (to: number): void => {
    if (open === null) return;
    sections.set(open.heading, {
      heading: open.heading,
      line: open.line,
      body: lines.slice(open.from, to).join('\n').trim(),
    });
  };

  lines.forEach((raw, index) => {
    const m = HEADING.exec(raw.replace(/\r$/, ''));
    if (m === null) return;
    close(index);
    open = { heading: m[1]!, line: index, from: index + 1 };
  });
  close(lines.length);

  return sections;
}

export function readTicket(text: string): Ticket {
  return {
    frontMatter: parseFrontMatter(text),
    sections: readSections(text),
    lineCount: text.split('\n').length,
  };
}

/**
 * The `claim_*` fields this workspace's ticket schema names, in the order it names them.
 *
 * Read from the schema rather than held as a list in here — that is the whole lesson of C7. A
 * workspace that names none gets an honest "unknown", not a pass.
 */
export function claimFieldsOf(schema: unknown): string[] | null {
  if (!isObject(schema)) return null;
  const properties = schema['properties'];
  if (!isObject(properties)) return null;
  const fields = Object.keys(properties).filter((key) => key.startsWith('claim_'));
  return fields.length === 0 ? null : fields;
}

/** The fields this workspace's ticket schema says a `resolution` block carries. */
export function resolutionFieldsOf(schema: unknown): string[] | null {
  if (!isObject(schema)) return null;
  const properties = schema['properties'];
  if (!isObject(properties)) return null;
  const resolution = properties['resolution'];
  if (!isObject(resolution)) return null;
  const required = resolution['required'];
  if (Array.isArray(required)) {
    const names = required.filter((k): k is string => typeof k === 'string');
    if (names.length > 0) return names;
  }
  const sub = resolution['properties'];
  if (!isObject(sub)) return null;
  const keys = Object.keys(sub);
  return keys.length === 0 ? null : keys;
}

function schemaFindings(fm: FrontMatter, law: TicketLaw): LawFinding[] {
  if (law.ticketSchema === null || law.ticketSchema === undefined) {
    return [
      {
        code: 'ticket-schema-unknown',
        severity: 'information',
        message: `no ${law.ticketSchemaPath} in this workspace, so this ticket's front matter was not validated — unknown, not clean. law-plank reads the workspace's own schema and never carries one.`,
        ...positionOf(fm, ''),
      },
    ];
  }

  const errors: ValidationError[] = validate(fm.value, law.ticketSchema);
  return errors.map((error) => {
    const at = positionOf(fm, error.path);
    if (error.unsupported === true) {
      return {
        code: 'ticket-schema-unknown' as const,
        severity: 'warning' as const,
        message: `${law.ticketSchemaPath} uses something law-plank cannot check (${error.message}) — this part of the ticket is unknown, not clean`,
        ...at,
      };
    }
    return {
      code: 'ticket-schema' as const,
      severity: 'error' as const,
      message: error.path === '' ? error.message : `${error.path}: ${error.message}`,
      ...at,
    };
  });
}

/** Every place in a ticket's front matter that names a witness. */
function witnessPaths(value: Record<string, unknown>): string[] {
  const paths = Object.keys(value).filter((key) => key === 'witness' || key.endsWith('_witness'));
  const resolution = value['resolution'];
  if (isObject(resolution) && 'witness' in resolution) paths.push('resolution.witness');
  return paths;
}

function valueAt(value: Record<string, unknown>, path: string): unknown {
  const dot = path.indexOf('.');
  if (dot === -1) return value[path];
  const head = value[path.slice(0, dot)];
  return isObject(head) ? head[path.slice(dot + 1)] : undefined;
}

/** T1 — the writer rule. No part of a ticket stands on memory. */
function t1Findings(fm: FrontMatter): LawFinding[] {
  if (!isObject(fm.value)) return [];
  const value = fm.value;
  return witnessPaths(value)
    .filter((path) => valueAt(value, path) === INADMISSIBLE_WITNESS)
    .map((path) => ({
      code: 'T1' as const,
      severity: 'error' as const,
      message: `T1: \`${path}: ${INADMISSIBLE_WITNESS}\` — memory is admissible in a checkpoint tick, never in a ticket. A ticket outlives the conversation it was written in; name the ledger entry, the result, the spec, the approval or the operator that will still be there.`,
      ...positionOf(fm, path),
    }));
}

/**
 * T2 — a resolved ticket carries its resolution.
 *
 * Only the presence of the block is checked here. What is *inside* it is the schema's business,
 * and checking it twice would put the same complaint in front of a reader twice.
 */
function t2Findings(fm: FrontMatter, fields: readonly string[] | null): LawFinding[] {
  if (!isObject(fm.value)) return [];
  if (fm.value['status'] !== RESOLVED) return [];
  if ('resolution' in fm.value) return [];

  const message = `T2: this ticket is \`${RESOLVED}\` but carries no \`resolution\` — a ticket that is over has to say what was decided and what proves it`;
  const at = positionOf(fm, 'status');

  // No skeleton to offer when the workspace's schema does not describe one. The finding still
  // stands: the rule is about the block being there, not about what this plank can write.
  if (fields === null || fields.length === 0) {
    return [{ code: 'T2', severity: 'error', message, ...at }];
  }

  return [
    {
      code: 'T2',
      severity: 'error',
      message,
      ...at,
      fix: { title: 'Insert the resolution skeleton', kind: 'insert-resolution-skeleton', fields },
    },
  ];
}

/** T3 — a claimed ticket carries the claim block its workspace's schema describes. */
function t3Findings(fm: FrontMatter, law: TicketLaw, fields: readonly string[] | null): LawFinding[] {
  if (!isObject(fm.value)) return [];
  if (fm.value['status'] !== CLAIMED) return [];
  const at = positionOf(fm, 'status');

  if (fields === null) {
    return [
      {
        code: 'T3',
        severity: 'information',
        message: `T3: this ticket is \`${CLAIMED}\`, but ${law.ticketSchemaPath} names no \`claim_*\` fields — what a claimed ticket owes is unknown here, not clean`,
        ...at,
      },
    ];
  }

  const value = fm.value;
  const missing = fields.filter((field) => !(field in value));
  if (missing.length === 0) return [];

  return [
    {
      code: 'T3',
      severity: 'error',
      message: `T3: this ticket is \`${CLAIMED}\` but ${missing.length === 1 ? 'does not carry' : 'is missing'} ${missing.map((f) => `\`${f}\``).join(', ')} — a claim that does not say who holds it, or until when, is not a claim anybody can rely on`,
      ...at,
      fix: { title: 'Insert the claim block', kind: 'insert-claim-block', fields: missing },
    },
  ];
}

/** T4 — the two sections a person reads. */
function t4Findings(ticket: Ticket): LawFinding[] {
  const fm = ticket.frontMatter;
  const endOfDocument = { line: Math.max(0, ticket.lineCount - 1), column: 0, endColumn: 3 };
  const findings: LawFinding[] = [];

  const gist = ticket.sections.get('Gist');
  if (gist === undefined) {
    findings.push({
      code: 'T4',
      severity: 'error',
      message: 'T4: this ticket has no `## Gist` — the front matter is the record, the gist is the part somebody reads',
      ...endOfDocument,
    });
  } else if (gist.body === '') {
    findings.push({
      code: 'T4',
      severity: 'error',
      message: 'T4: `## Gist` is empty',
      line: gist.line,
      column: 0,
      endColumn: 7,
    });
  }

  if (isObject(fm.value) && fm.value['status'] === RESOLVED) {
    const resolution = ticket.sections.get('Resolution');
    if (resolution === undefined) {
      findings.push({
        code: 'T4',
        severity: 'error',
        message: `T4: this ticket is \`${RESOLVED}\` but has no \`## Resolution\` — the front matter records the decision, this section is where it is explained`,
        ...endOfDocument,
      });
    } else if (resolution.body === '') {
      findings.push({
        code: 'T4',
        severity: 'error',
        message: 'T4: `## Resolution` is empty',
        line: resolution.line,
        column: 0,
        endColumn: 13,
      });
    }
  }

  return findings;
}

export function checkTicket(ticket: Ticket, law: TicketLaw): LawFinding[] {
  const fm = ticket.frontMatter;

  if (fm.range === null && fm.error === undefined) {
    return [
      {
        code: 'front-matter',
        severity: 'error',
        message: 'this document has no front matter — a ticket opens with a `---` fenced block',
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

  return inReadingOrder([
    ...schemaFindings(fm, law),
    ...t1Findings(fm),
    ...t2Findings(fm, resolutionFieldsOf(law.ticketSchema)),
    ...t3Findings(fm, law, claimFieldsOf(law.ticketSchema)),
    ...t4Findings(ticket),
  ]);
}
