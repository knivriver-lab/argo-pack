/**
 * The ticket rules.
 *
 * Everything here reads from `test/fixtures/`, which is a small hand-authored tree standing in
 * for an open workspace: a ticket schema and three tickets, written to the shape the rules are
 * for. Nothing in it is copied from a workspace that keeps tickets — argo-pack keeps none, which
 * is exactly why the fixtures exist.
 *
 * The negatives are the clean fixtures with one thing changed. That form is worth keeping: it
 * makes it obvious what each rule is actually about, and it makes a rule that started passing
 * for the wrong reason visible, because the clean case is asserted at zero in the same file.
 *
 * Nothing here imports `vscode`.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { countToFix, type LawFinding } from '../src/finding.js';
import { resolveFix, type PlainEdit } from '../src/fixes.js';
import {
  CLAIMED,
  INADMISSIBLE_WITNESS,
  RESOLVED,
  checkTicket,
  claimFieldsOf,
  readSections,
  readTicket,
  resolutionFieldsOf,
  type TicketLaw,
} from '../src/ticket.js';

const FIXTURES = join(__dirname, 'fixtures');
const SCHEMA_PATH = 'docs/schema/ticket.schema.json';

const ticketSchema = JSON.parse(readFileSync(join(FIXTURES, 'docs/schema/ticket.schema.json'), 'utf8')) as unknown;

const fixture = (name: string): string => readFileSync(join(FIXTURES, 'docs/map/tickets', name), 'utf8');

const OPEN = fixture('T-0001-open.md');
const RESOLVED_TICKET = fixture('T-0002-resolved.md');
const CLAIMED_TICKET = fixture('T-0003-claimed.md');

function law(overrides: Partial<TicketLaw> = {}): TicketLaw {
  return { ticketSchema, ticketSchemaPath: SCHEMA_PATH, ...overrides };
}

const check = (text: string, overrides?: Partial<TicketLaw>): LawFinding[] =>
  checkTicket(readTicket(text), law(overrides));

const codes = (text: string, overrides?: Partial<TicketLaw>): string[] =>
  check(text, overrides).map((f) => f.code);

function apply(text: string, edit: PlainEdit): string {
  const lines = text.split('\n');
  const offsetOf = (line: number, column: number): number => {
    let offset = 0;
    for (let i = 0; i < line; i++) offset += (lines[i]?.length ?? 0) + 1;
    return offset + column;
  };
  return text.slice(0, offsetOf(edit.startLine, edit.startColumn)) + edit.newText + text.slice(offsetOf(edit.endLine, edit.endColumn));
}

describe('the three clean fixtures', () => {
  it.each([
    ['open', OPEN],
    ['resolved', RESOLVED_TICKET],
    ['claimed', CLAIMED_TICKET],
  ])('a %s ticket that satisfies the law produces no findings', (_name, text) => {
    expect(check(text)).toEqual([]);
    expect(countToFix(check(text))).toBe(0);
  });
});

describe('front matter', () => {
  it('is required', () => {
    const findings = check('## Gist\n\nno front matter here\n');
    expect(findings[0]?.code).toBe('front-matter');
    expect(findings[0]?.message).toContain('a ticket opens');
  });

  it('is reported rather than thrown when it cannot be read', () => {
    const findings = check('---\nid: T-0001\n\tbad: indent\n---\n\n## Gist\n\nx\n');
    expect(findings[0]?.code).toBe('front-matter');
    expect(findings[0]?.message).toContain('could not be read');
  });
});

describe('the schema check', () => {
  it('errors on a witness outside the closed vocabulary', () => {
    const findings = check(OPEN.replace('witness: spec:0002-ticket-pathway-validation', 'witness: somebody said so'));
    const schema = findings.find((f) => f.code === 'ticket-schema');
    expect(schema?.severity).toBe('error');
    expect(schema?.message).toContain('witness');
  });

  it.each([
    ['ledger:41', true],
    ['result:1f4a9c2', true],
    ['spec:0002-ticket-pathway-validation', true],
    ['approval:argo-p4', true],
    ['operator', true],
    ['a-colleague', false],
    ['ledger:', false],
    ['spec:nope', false],
  ])('%s is %s in the vocabulary', (witness, admissible) => {
    const findings = check(OPEN.replace('witness: spec:0002-ticket-pathway-validation', `witness: ${witness}`));
    expect(findings.some((f) => f.code === 'ticket-schema')).toBe(!admissible);
  });

  it('errors on a missing required field', () => {
    expect(codes(OPEN.replace(/^valid_at: .*\n/m, ''))).toContain('ticket-schema');
  });

  it('errors on a field the schema does not know', () => {
    expect(codes(OPEN.replace('deps: []', 'deps: []\nurgency: high'))).toContain('ticket-schema');
  });

  // A check that cannot read its input has not passed.
  it('reports unknown, not clean, when the workspace has no ticket schema', () => {
    const findings = check(OPEN, { ticketSchema: null });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe('ticket-schema-unknown');
    expect(findings[0]?.severity).toBe('information');
    expect(findings[0]?.message).toContain('unknown, not clean');
  });

  it('reports unknown when the schema uses something it cannot check', () => {
    const findings = check(OPEN, { ticketSchema: { type: 'object', propertyNames: { pattern: '^x$' } } });
    expect(findings.some((f) => f.code === 'ticket-schema-unknown' && f.severity === 'warning')).toBe(true);
  });
});

/**
 * T1 is the rule no schema can carry, and the fixture schema proves it: `memory` is inside the
 * witness pattern there, because a checkpoint tick may legitimately stand on it. Whether a
 * *ticket* may is a question about the writer, not about the value, and only the writer knows.
 */
describe(`T1 — a ticket may not stand on \`${INADMISSIBLE_WITNESS}\``, () => {
  it('errors, even though the schema admits the value', () => {
    const text = OPEN.replace('witness: spec:0002-ticket-pathway-validation', `witness: ${INADMISSIBLE_WITNESS}`);
    expect(check(text).filter((f) => f.code === 'ticket-schema')).toEqual([]);

    const t1 = check(text).find((f) => f.code === 'T1');
    expect(t1?.severity).toBe('error');
    expect(t1?.message).toContain('checkpoint tick');
    expect(t1?.message).toContain('outlives the conversation');
  });

  it('points at the witness line, not at the block', () => {
    const text = OPEN.replace('witness: spec:0002-ticket-pathway-validation', `witness: ${INADMISSIBLE_WITNESS}`);
    expect(check(text).find((f) => f.code === 'T1')?.line).toBe(5);
  });

  it('reaches a resolution that stands on memory too', () => {
    const text = RESOLVED_TICKET.replace('  witness: result:1f4a9c2', `  witness: ${INADMISSIBLE_WITNESS}`);
    const t1 = check(text).find((f) => f.code === 'T1');
    expect(t1?.severity).toBe('error');
    expect(t1?.message).toContain('resolution.witness');
  });

  it('reaches a claim that stands on memory too', () => {
    const text = CLAIMED_TICKET.replace('claim_witness: approval:argo-p4', `claim_witness: ${INADMISSIBLE_WITNESS}`);
    expect(check(text).find((f) => f.code === 'T1')?.message).toContain('claim_witness');
  });

  it('says nothing about a witness that is anything else', () => {
    expect(check(OPEN).filter((f) => f.code === 'T1')).toEqual([]);
  });
});

describe(`T2 — a \`${RESOLVED}\` ticket carries its resolution`, () => {
  const withoutResolution = RESOLVED_TICKET.replace(
    /^resolution:\n(?: {2}.*\n)+/m,
    '',
  );

  it('errors when the resolution block is missing', () => {
    const t2 = check(withoutResolution).find((f) => f.code === 'T2');
    expect(t2?.severity).toBe('error');
    expect(t2?.message).toContain('what was decided and what proves it');
  });

  it('offers a skeleton built from the workspace schema, not from a list held here', () => {
    expect(resolutionFieldsOf(ticketSchema)).toEqual(['witness', 'valid_at', 'ledger_seq', 'decision']);
    const fix = check(withoutResolution).find((f) => f.code === 'T2')?.fix;
    expect(fix?.kind).toBe('insert-resolution-skeleton');
    expect(fix?.fields).toEqual(['witness', 'valid_at', 'ledger_seq', 'decision']);
  });

  it('writes the skeleton into the front matter, leaving the prose alone', () => {
    const fix = check(withoutResolution).find((f) => f.code === 'T2')?.fix;
    const resolved = resolveFix(fix!, withoutResolution, readTicket(withoutResolution).frontMatter, null);
    expect(resolved?.target).toBe('document');

    const after = apply(withoutResolution, (resolved as { edit: PlainEdit }).edit);
    expect(after).toContain('resolution:\n  witness: TODO\n  valid_at: TODO\n  ledger_seq: TODO\n  decision: TODO\n');
    expect(after).toContain('## Resolution');
    expect(readTicket(after).sections.get('Gist')?.body).toBe(readTicket(withoutResolution).sections.get('Gist')?.body);
  });

  // The skeleton is a way of satisfying the rule, not a way of getting past it.
  it('leaves the ticket failing its schema afterwards, because TODO is not a witness', () => {
    const fix = check(withoutResolution).find((f) => f.code === 'T2')?.fix;
    const resolved = resolveFix(fix!, withoutResolution, readTicket(withoutResolution).frontMatter, null);
    const after = apply(withoutResolution, (resolved as { edit: PlainEdit }).edit);
    expect(check(after).filter((f) => f.code === 'T2')).toEqual([]);
    expect(codes(after)).toContain('ticket-schema');
  });

  it('says nothing about a ticket that is not resolved', () => {
    expect(check(OPEN).filter((f) => f.code === 'T2')).toEqual([]);
  });

  it('leaves what is inside the block to the schema, so a reader is not told twice', () => {
    const text = RESOLVED_TICKET.replace('  ledger_seq: 41\n', '');
    expect(check(text).filter((f) => f.code === 'T2')).toEqual([]);
    expect(codes(text)).toContain('ticket-schema');
  });
});

describe(`T3 — a \`${CLAIMED}\` ticket carries its claim block`, () => {
  const withoutClaim = CLAIMED_TICKET.replace(/^claim_.*\n/gm, '');

  it('errors, naming every claim_* field the workspace schema knows about', () => {
    expect(claimFieldsOf(ticketSchema)).toEqual([
      'claim_by',
      'claim_at',
      'claim_ttl',
      'claim_pathway',
      'claim_witness',
      'claim_release',
    ]);

    const t3 = check(withoutClaim).find((f) => f.code === 'T3');
    expect(t3?.severity).toBe('error');
    for (const field of claimFieldsOf(ticketSchema)!) expect(t3?.message).toContain(field);
  });

  it('is a rule no schema expressed — the fixture schema passes this document', () => {
    expect(check(withoutClaim).filter((f) => f.code === 'ticket-schema')).toEqual([]);
  });

  it('names only the fields that are actually missing', () => {
    const text = CLAIMED_TICKET.replace('claim_release: the ttl runs out, or the claimant says so\n', '');
    const t3 = check(text).find((f) => f.code === 'T3');
    expect(t3?.fix?.fields).toEqual(['claim_release']);
    expect(t3?.message).toContain('claim_release');
    expect(t3?.message).not.toContain('claim_by');
  });

  it('writes the claim block as a code action', () => {
    const fix = check(withoutClaim).find((f) => f.code === 'T3')?.fix;
    expect(fix?.kind).toBe('insert-claim-block');

    const resolved = resolveFix(fix!, withoutClaim, readTicket(withoutClaim).frontMatter, null);
    const after = apply(withoutClaim, (resolved as { edit: PlainEdit }).edit);
    const front = readTicket(after).frontMatter.value as Record<string, unknown>;
    expect(Object.keys(front).filter((k) => k.startsWith('claim_'))).toEqual(claimFieldsOf(ticketSchema));
    expect(check(after).filter((f) => f.code === 'T3')).toEqual([]);
  });

  it('says nothing about a ticket that is not claimed', () => {
    expect(check(OPEN).filter((f) => f.code === 'T3')).toEqual([]);
  });

  it('reports unknown when the workspace schema names no claim_* fields', () => {
    const findings = check(withoutClaim, { ticketSchema: { type: 'object' } });
    const t3 = findings.find((f) => f.code === 'T3');
    expect(t3?.severity).toBe('information');
    expect(t3?.message).toContain('unknown here, not clean');
  });
});

describe('T4 — the two sections a person reads', () => {
  it('errors when there is no `## Gist`', () => {
    const text = OPEN.replace('## Gist', '## Summary');
    expect(check(text).find((f) => f.code === 'T4')?.message).toContain('## Gist');
  });

  it('errors when the gist is only a heading', () => {
    const text = `${OPEN.slice(0, OPEN.indexOf('## Gist'))}## Gist\n`;
    expect(check(text).find((f) => f.code === 'T4')?.message).toContain('empty');
  });

  it('errors when a resolved ticket has no `## Resolution`', () => {
    const text = RESOLVED_TICKET.slice(0, RESOLVED_TICKET.indexOf('## Resolution'));
    expect(check(text).find((f) => f.code === 'T4')?.message).toContain('## Resolution');
  });

  it('does not ask an open ticket for a resolution section', () => {
    expect(check(OPEN).filter((f) => f.code === 'T4')).toEqual([]);
  });
});

describe('readSections', () => {
  it('keys sections by heading and keeps the body between them', () => {
    const sections = readSections('---\nid: x\n---\n\n## One\n\nfirst\n\n## Two\n\nsecond\n');
    expect([...sections.keys()]).toEqual(['One', 'Two']);
    expect(sections.get('One')?.body).toBe('first');
    expect(sections.get('Two')?.body).toBe('second');
    expect(sections.get('Two')?.line).toBe(8);
  });

  it('finds nothing in a document with no headings', () => {
    expect(readSections('just prose\n').size).toBe(0);
  });
});

describe('the field lists, read from the schema', () => {
  it('come back null when the schema describes none, so the caller can say unknown', () => {
    expect(claimFieldsOf({ type: 'object', properties: { id: { type: 'string' } } })).toBeNull();
    expect(resolutionFieldsOf({ type: 'object', properties: {} })).toBeNull();
    expect(claimFieldsOf(null)).toBeNull();
    expect(resolutionFieldsOf('not a schema')).toBeNull();
  });

  it('falls back to the resolution properties when the schema requires nothing', () => {
    expect(
      resolutionFieldsOf({
        properties: { resolution: { properties: { decision: { type: 'string' }, witness: { type: 'string' } } } },
      }),
    ).toEqual(['decision', 'witness']);
  });
});
