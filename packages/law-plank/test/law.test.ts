/**
 * The five checks, each with a fixture that passes and one that does not.
 *
 * Nothing here imports `vscode`. That is not a testing trick — it is the shape of the plank. The
 * rules take a document and a description of the workspace and return findings; the editor half
 * is an adapter over exactly this.
 *
 * The schema used below is argo-pack's own `docs/schema/unit.schema.json`, read from disk the
 * same way law-plank reads a workspace's at runtime — which also keeps these tests honest about
 * the schema the pack actually ships against.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseDepsToml } from '../src/deps-toml.js';
import { parseFrontMatter } from '../src/front-matter.js';
import { checkUnit, countToFix, unitIdOf, type LawFinding, type WorkspaceLaw } from '../src/law.js';
import { readPathway, type PathwayDeclaration } from '../src/pathway.js';

const unitSchema = JSON.parse(
  readFileSync(join(__dirname, '../../../docs/schema/unit.schema.json'), 'utf8'),
) as unknown;

/**
 * argo-pack's own `docs/pathways/*.toml`, read from disk exactly the way law-plank reads a
 * workspace's at runtime. C7 has no table of its own any more, so this is the only place the
 * pathways come from — here as in the editor.
 */
const PATHWAYS_DIR = join(__dirname, '../../../docs/pathways');

function ownPathways(): Map<string, PathwayDeclaration> {
  const byId = new Map<string, PathwayDeclaration>();
  for (const file of readdirSync(PATHWAYS_DIR).filter((f) => f.endsWith('.toml')).sort()) {
    const declaration = readPathway(`docs/pathways/${file}`, readFileSync(join(PATHWAYS_DIR, file), 'utf8'));
    byId.set(declaration.id ?? file.replace(/\.toml$/, ''), declaration);
  }
  return byId;
}

const GOOD = `---
id: 0001-a-good-unit
title: A unit that satisfies the law
pathway: foundry
human_word:
  - dispatch
  - land
weight: W2
deps: []
design_ref: docs/design/thing.md
deliverables:
  - the thing
---

## Spec

Prose below the fence is the unit's own business.
`;

function law(overrides: Partial<WorkspaceLaw> = {}): WorkspaceLaw {
  return {
    unitSchema,
    unitSchemaPath: 'docs/schema/unit.schema.json',
    unitIds: new Set(['0001-a-good-unit']),
    deps: parseDepsToml(''),
    depsPath: 'docs/deps.toml',
    pathways: ownPathways(),
    pathwaysDir: 'docs/pathways',
    ...overrides,
  };
}

const check = (text: string, overrides?: Partial<WorkspaceLaw>): LawFinding[] =>
  checkUnit(parseFrontMatter(text), law(overrides));

const codes = (text: string, overrides?: Partial<WorkspaceLaw>): string[] =>
  check(text, overrides).map((f) => f.code);

describe('a unit that satisfies the law', () => {
  it('produces no findings', () => {
    expect(check(GOOD)).toEqual([]);
  });
});

describe('front matter', () => {
  it('is required', () => {
    const findings = check('# Just a heading\n');
    expect(findings[0]?.code).toBe('front-matter');
    expect(findings[0]?.severity).toBe('error');
  });

  it('must be closed', () => {
    expect(codes('---\nid: 0001-a-good-unit\n')).toEqual(['front-matter']);
  });

  it('reports unreadable YAML as a finding rather than throwing', () => {
    const findings = check('---\nid: 0001-a-good-unit\n\tbad: indent\n---\n');
    expect(findings[0]?.code).toBe('front-matter');
    expect(findings[0]?.message).toContain('could not be read');
  });
});

describe('the schema check', () => {
  it('reports a front-matter field of the wrong type', () => {
    const findings = check(GOOD.replace('weight: W2', 'weight: heavy'));
    expect(findings.some((f) => f.code === 'schema' && f.message.includes('weight'))).toBe(true);
  });

  it('reports an unknown field', () => {
    expect(codes(GOOD.replace('title:', 'titel:'))).toContain('schema');
  });

  // A check that cannot read its input has not passed. This is the whole reason the plank reads
  // the workspace's schema rather than carrying one: when there is none, it has to say so.
  it('reports unknown, not clean, when the workspace has no schema', () => {
    const findings = check(GOOD, { unitSchema: null });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe('schema-unknown');
    expect(findings[0]?.severity).toBe('information');
    expect(findings[0]?.message).toContain('unknown, not clean');
  });

  it('reports unknown when the schema uses something it cannot check', () => {
    const findings = check(GOOD, { unitSchema: { type: 'object', propertyNames: { pattern: '^x$' } } });
    expect(findings.some((f) => f.code === 'schema-unknown' && f.severity === 'warning')).toBe(true);
  });
});

describe('C6 — the join closes', () => {
  const withDep = GOOD.replace('deps: []', 'deps:\n  - 0002-another-unit');

  it('errors when a dep id resolves to no document', () => {
    const findings = check(withDep, { unitIds: new Set(['0001-a-good-unit']) });
    const c6 = findings.find((f) => f.code === 'C6');
    expect(c6?.severity).toBe('error');
    expect(c6?.message).toContain('does not resolve');
    expect(c6?.fix).toBeUndefined();
  });

  it('warns, with a fix, when the id resolves but the edge is not recorded', () => {
    const findings = check(withDep, { unitIds: new Set(['0001-a-good-unit', '0002-another-unit']) });
    const c6 = findings.find((f) => f.code === 'C6');
    expect(c6?.severity).toBe('warning');
    expect(c6?.fix?.kind).toBe('add-deps-entry');
    expect(c6?.fix?.from).toBe('0001-a-good-unit');
    expect(c6?.fix?.to).toBe('0002-another-unit');
  });

  it('passes once the edge is in deps.toml', () => {
    const findings = check(withDep, {
      unitIds: new Set(['0001-a-good-unit', '0002-another-unit']),
      deps: parseDepsToml('[[edge]]\nfrom = "0001-a-good-unit"\nto = "0002-another-unit"\n'),
    });
    expect(findings.filter((f) => f.code === 'C6')).toEqual([]);
  });

  it('offers to create deps.toml when the workspace has none', () => {
    const findings = check(withDep, {
      unitIds: new Set(['0001-a-good-unit', '0002-another-unit']),
      deps: null,
    });
    expect(findings.find((f) => f.code === 'C6')?.fix?.kind).toBe('add-deps-entry');
  });

  it('points at the offending dep, not at the block', () => {
    const findings = check(withDep, { unitIds: new Set(['0001-a-good-unit']) });
    // deps: is line 8 (zero-based), the item beneath it is line 9.
    expect(findings.find((f) => f.code === 'C6')?.line).toBe(9);
  });
});

/**
 * C7 after P4.
 *
 * The rule used to read a constant table in `law.ts`. That table is gone — these tests read
 * `docs/pathways/*.toml`, and every one of them fails if the directory does. That is deliberate:
 * a test that could pass with the table still present would not be testing the change.
 */
describe('C7 — the pathway is declared, and the human words are ones it offers', () => {
  const c7 = (text: string, overrides?: Partial<WorkspaceLaw>): LawFinding[] =>
    check(text, overrides).filter((f) => f.code === 'C7');

  it('is clean when every claimed word is one the pathway offers', () => {
    // foundry offers dispatch, land and release; this unit claims two of the three.
    expect(ownPathways().get('foundry')?.approvals).toEqual(['dispatch', 'land', 'release']);
    expect(c7(GOOD)).toEqual([]);
    expect(countToFix(check(GOOD))).toBe(0);
  });

  it('is clean when a unit claims fewer says than the pathway offers', () => {
    const text = GOOD.replace('  - dispatch\n  - land\n', '  - land\n');
    expect(c7(text)).toEqual([]);
  });

  it('errors on a pathway no file in docs/pathways declares', () => {
    // The schema's enum would have caught this one too. C7 catches it whatever the enum says,
    // which is the point: the refusal is the plank's own.
    const findings = c7(GOOD.replace('pathway: foundry', 'pathway: improvised'));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.message).toContain('is not declared');
    expect(findings[0]?.message).toContain('docs/pathways/');
  });

  it('errors on a human word the pathway does not offer, pointing at the word', () => {
    const text = GOOD.replace('  - land\n', '  - land\n  - hitl-resolve\n');
    const findings = c7(text);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.message).toContain('offers no approval `hitl-resolve`');
    // `human_word:` is line 4 (zero-based); its items are 5, 6 and — once inserted — 7.
    expect(findings[0]?.line).toBe(7);
  });

  it('errors once per word that is not offered', () => {
    const text = GOOD.replace('  - dispatch\n  - land\n', '  - invented\n  - also-invented\n');
    expect(c7(text)).toHaveLength(2);
  });

  it('is clean on a pathway that offers no says, when the unit claims none', () => {
    const text = GOOD.replace('pathway: foundry', 'pathway: direct').replace(
      'human_word:\n  - dispatch\n  - land\n',
      '',
    );
    expect(ownPathways().get('direct')?.approvals).toEqual([]);
    expect(c7(text)).toEqual([]);
  });

  it('errors on a word claimed against a pathway that offers none at all', () => {
    const text = GOOD.replace('pathway: foundry', 'pathway: direct');
    expect(c7(text).map((f) => f.severity)).toEqual(['error', 'error']);
  });

  // Not an error: a unit may use fewer of a pathway's says than all of them. But a unit using
  // none of them, on a pathway that offers some, is nearly always an oversight.
  it('warns, with a fix per approval, when a unit claims no human words at all', () => {
    const text = GOOD.replace('human_word:\n  - dispatch\n  - land\n', '');
    const findings = c7(text);
    expect(findings.map((f) => f.severity)).toEqual(['warning', 'warning', 'warning']);
    expect(findings.map((f) => f.fix?.word)).toEqual(['dispatch', 'land', 'release']);
    expect(findings[0]?.fix?.kind).toBe('add-human-word');
  });

  it('names the declaration the approvals came from, so a reader can go and look', () => {
    const text = GOOD.replace('  - land\n', '  - land\n  - invented\n');
    expect(c7(text)[0]?.message).toContain('docs/pathways/foundry.toml');
  });

  // A check that cannot read its input has not passed.
  it('reports unknown, not clean, when the workspace declares no pathways at all', () => {
    const findings = c7(GOOD, { pathways: null });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('information');
    expect(findings[0]?.message).toContain('unknown');
    expect(countToFix(findings)).toBe(0);
  });

  it('says which ids are declared when the one named is not among them', () => {
    const findings = c7(GOOD.replace('pathway: foundry', 'pathway: improvised'), {
      pathways: new Map([['reviewed', readPathway('docs/pathways/reviewed.toml', 'id = "reviewed"\n')]]),
    });
    expect(findings[0]?.message).toContain('`reviewed`');
  });
});

describe('C8 — design_ref and deliverables above the W1 threshold', () => {
  const strip = (text: string): string =>
    text.replace('design_ref: docs/design/thing.md\n', '').replace('deliverables:\n  - the thing\n', '');

  it('does not apply below the threshold', () => {
    expect(check(strip(GOOD).replace('weight: W2', 'weight: W0')).filter((f) => f.code === 'C8')).toEqual([]);
  });

  it('applies at the threshold', () => {
    expect(codes(strip(GOOD).replace('weight: W2', 'weight: W1'))).toContain('C8');
  });

  it('applies above the threshold, naming both missing keys', () => {
    const c8 = check(strip(GOOD)).find((f) => f.code === 'C8');
    expect(c8?.severity).toBe('warning');
    expect(c8?.fix?.missing).toEqual(['design_ref', 'deliverables']);
  });

  it('names only the key that is actually missing', () => {
    const text = GOOD.replace('deliverables:\n  - the thing\n', '');
    expect(check(text).find((f) => f.code === 'C8')?.fix?.missing).toEqual(['deliverables']);
  });

  // The quick fix writes a TODO. If C8 accepted a TODO, the action would be a way of getting
  // past the rule rather than a way of satisfying it.
  it('goes on counting a TODO placeholder as missing', () => {
    const text = GOOD.replace('design_ref: docs/design/thing.md', 'design_ref: TODO');
    const c8 = check(text).find((f) => f.code === 'C8');
    expect(c8?.fix?.missing).toEqual(['design_ref']);
    expect(c8?.message).toContain('TODO');
  });

  it('counts an all-TODO deliverables list as missing', () => {
    const text = GOOD.replace('  - the thing', '  - TODO');
    expect(check(text).find((f) => f.code === 'C8')?.fix?.missing).toEqual(['deliverables']);
  });
});

describe('C5 — open questions', () => {
  const withQuestions = GOOD.replace(
    'deliverables:\n  - the thing\n',
    'deliverables:\n  - the thing\nopen_questions:\n  - Whether the keel stays a single value.\n',
  );

  it('is informational, never a failure', () => {
    const c5 = check(withQuestions).find((f) => f.code === 'C5');
    expect(c5?.severity).toBe('information');
    expect(c5?.message).toContain('1 open question still standing');
  });

  it('says nothing when there are none', () => {
    expect(check(GOOD).filter((f) => f.code === 'C5')).toEqual([]);
  });

  it('is not counted by the status bar, because it is not a thing to fix', () => {
    expect(countToFix(check(withQuestions))).toBe(0);
  });
});

describe('countToFix', () => {
  it('counts errors and warnings only', () => {
    expect(
      countToFix([
        { code: 'C6', severity: 'error', message: '', line: 0, column: 0, endColumn: 1 },
        { code: 'C7', severity: 'warning', message: '', line: 0, column: 0, endColumn: 1 },
        { code: 'C5', severity: 'information', message: '', line: 0, column: 0, endColumn: 1 },
      ]),
    ).toBe(2);
  });
});

describe('unitIdOf', () => {
  it('reads the id a document claims', () => {
    expect(unitIdOf(parseFrontMatter(GOOD).value)).toBe('0001-a-good-unit');
  });

  it('returns null when there is none', () => {
    expect(unitIdOf(parseFrontMatter('---\ntitle: no id\n---\n').value)).toBeNull();
    expect(unitIdOf(null)).toBeNull();
  });
});

describe("argo-pack's own unit documents", () => {
  // The pack governs itself by the same law. If any of this ever fails, the pack is asking of
  // others something it does not do. Every document in docs/units is read, not a list of the
  // ones that were passing when somebody last looked.
  const UNITS_DIR = join(__dirname, '../../../docs/units');
  const files = readdirSync(UNITS_DIR)
    .filter((f) => f.endsWith('.md'))
    .sort();

  const law: WorkspaceLaw = {
    unitSchema,
    unitSchemaPath: 'docs/schema/unit.schema.json',
    unitIds: new Set(
      files.map((f) => unitIdOf(parseFrontMatter(readFileSync(join(UNITS_DIR, f), 'utf8')).value)).filter(
        (id): id is string => id !== null,
      ),
    ),
    deps: parseDepsToml(readFileSync(join(__dirname, '../../../docs/deps.toml'), 'utf8')),
    depsPath: 'docs/deps.toml',
    pathways: ownPathways(),
    pathwaysDir: 'docs/pathways',
  };

  it('are all there is — the law is applied to the directory, not to a list', () => {
    expect(files.length).toBeGreaterThanOrEqual(2);
    expect(law.unitIds.size).toBe(files.length);
  });

  it.each(files)('%s satisfies the law, with only its open questions standing', (file) => {
    const findings = checkUnit(parseFrontMatter(readFileSync(join(UNITS_DIR, file), 'utf8')), law);
    expect(findings.filter((f) => f.severity !== 'information')).toEqual([]);
    expect(countToFix(findings)).toBe(0);
  });
});
