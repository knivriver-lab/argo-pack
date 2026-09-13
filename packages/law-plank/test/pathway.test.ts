/**
 * The pathway rules, and the assignment table.
 *
 * The declaration read here is argo-pack's own `docs/pathways/foundry.toml`, and the schema is
 * argo-pack's own `docs/schema/pathway.schema.json`. Both are real: the pack governs itself by
 * the same law it offers, and a rule that is painful to satisfy here would be painful to satisfy
 * anywhere. The two join files — `surfaces.yml` and `tools.yml` — are fixtures, because argo-pack
 * publishes neither, and the INFO-when-absent behaviour that produces is the other half of what
 * these tests are for.
 *
 * Nothing here imports `vscode`.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { countToFix, type LawFinding } from '../src/finding.js';
import {
  checkAssignment,
  checkPathway,
  namesFromYaml,
  readPathway,
  type PathwayDeclaration,
  type PathwayLaw,
} from '../src/pathway.js';

const ROOT = join(__dirname, '../../..');
const FIXTURES = join(__dirname, 'fixtures');

const pathwaySchema = JSON.parse(
  readFileSync(join(ROOT, 'docs/schema/pathway.schema.json'), 'utf8'),
) as unknown;

const FOUNDRY = readFileSync(join(ROOT, 'docs/pathways/foundry.toml'), 'utf8');

const surfaces = namesFromYaml(readFileSync(join(FIXTURES, 'docs/surfaces.yml'), 'utf8'), 'surfaces');
const tools = namesFromYaml(readFileSync(join(FIXTURES, 'docs/tools.yml'), 'utf8'), 'tools');

function law(overrides: Partial<PathwayLaw> = {}): PathwayLaw {
  return {
    pathwaySchema,
    pathwaySchemaPath: 'docs/schema/pathway.schema.json',
    surfaces,
    surfacesPath: 'docs/surfaces.yml',
    tools,
    toolsPath: 'docs/tools.yml',
    ...overrides,
  };
}

const check = (text: string, overrides?: Partial<PathwayLaw>): LawFinding[] =>
  checkPathway(readPathway('docs/pathways/foundry.toml', text), law(overrides));

const errors = (text: string, overrides?: Partial<PathwayLaw>): LawFinding[] =>
  check(text, overrides).filter((f) => f.severity === 'error');

describe('a pathway that satisfies the law', () => {
  it('has nothing to fix, with both joins closed', () => {
    expect(errors(FOUNDRY)).toEqual([]);
    expect(countToFix(check(FOUNDRY))).toBe(0);
  });

  it('still says out loud what it could not check', () => {
    // PW2 is unconditional: `posture_budget` and `approvals` are not verifiable from here, and a
    // check that always passed would be worse than one that says so.
    const pw2 = check(FOUNDRY).find((f) => f.code === 'PW2');
    expect(pw2?.severity).toBe('information');
    expect(pw2?.message).toContain('not verifiable at author time');
  });
});

describe('the schema check', () => {
  it('errors on an effects value outside the enum', () => {
    const findings = errors(FOUNDRY.replace('effects = "reviewed"', 'effects = "off"'));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe('pathway-schema');
    expect(findings[0]?.message).toContain('effects');
  });

  it('errors on a validation value outside the enum', () => {
    expect(errors(FOUNDRY.replace('validation = "required"', 'validation = "whenever"'))).toHaveLength(1);
  });

  // There is deliberately no way to say a pathway has no budget. "off" is the shape somebody
  // reaches for when they want one, and it is the shape the pattern refuses.
  it('errors on posture_budget = "off"', () => {
    const findings = errors(FOUNDRY.replace('posture_budget = "inherit"', 'posture_budget = "off"'));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('posture_budget');
  });

  it('accepts the two shapes a budget may take', () => {
    expect(errors(FOUNDRY.replace('posture_budget = "inherit"', 'posture_budget = "USD 40"'))).toEqual([]);
    expect(errors(FOUNDRY.replace('posture_budget = "inherit"', 'posture_budget = "USD 12.50"'))).toEqual([]);
  });

  it('errors on a stage with no halt', () => {
    const findings = errors(
      FOUNDRY.replace('halt = "a check is red, or the head has moved since the green that was read"\n', ''),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('halt');
  });

  it.each(['id', 'effects', 'validation', 'approvals', 'visibility', 'posture_budget', 'ttl'])(
    'errors when %s is missing',
    (key) => {
      const text = FOUNDRY.split('\n')
        .filter((line) => !line.startsWith(`${key} =`))
        .join('\n');
      expect(errors(text).some((f) => f.message.includes(key))).toBe(true);
    },
  );

  it('errors when there are no stages at all', () => {
    expect(errors(FOUNDRY.slice(0, FOUNDRY.indexOf('[[stages]]'))).some((f) => f.message.includes('stages'))).toBe(true);
  });

  // A check that cannot read its input has not passed.
  it('reports unknown, not clean, when the workspace has no pathway schema', () => {
    const findings = check(FOUNDRY.replace('effects = "reviewed"', 'effects = "off"'), { pathwaySchema: null });
    expect(findings.some((f) => f.code === 'pathway-schema-unknown' && f.severity === 'information')).toBe(true);
    expect(findings.filter((f) => f.code === 'pathway-schema')).toEqual([]);
    expect(findings.find((f) => f.code === 'pathway-schema-unknown')?.message).toContain('unknown, not clean');
  });
});

describe('the joins, as far as the workspace exposes them', () => {
  it('errors on a surface that docs/surfaces.yml does not list', () => {
    const findings = errors(FOUNDRY.replace('"unit-document"]', '"anywhere-really"]'));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe('PW1');
    expect(findings[0]?.message).toContain('anywhere-really');
    expect(findings[0]?.message).toContain('is not a surface');
  });

  // The same declaration, with the workspace exposing nothing to check it against.
  it('reports the same surface as unknown when there is no docs/surfaces.yml', () => {
    const text = FOUNDRY.replace('"unit-document"]', '"anywhere-really"]');
    const findings = check(text, { surfaces: null });
    expect(findings.filter((f) => f.severity === 'error')).toEqual([]);

    const info = findings.filter((f) => f.code === 'PW1' && f.severity === 'information');
    expect(info.some((f) => f.message.includes('docs/surfaces.yml'))).toBe(true);
    expect(info.some((f) => f.message.includes('not verified, and not a pass'))).toBe(true);
  });

  it('errors on a verb the tool manifest does not list', () => {
    const findings = errors(FOUNDRY.replace('verbs = ["squash-merge"]', 'verbs = ["force-push"]'));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('force-push');
    expect(findings[0]?.message).toContain('land');
  });

  it('reports verbs as unknown when the workspace publishes no tool manifest', () => {
    const findings = check(FOUNDRY.replace('verbs = ["squash-merge"]', 'verbs = ["force-push"]'), { tools: null });
    expect(findings.filter((f) => f.severity === 'error')).toEqual([]);
    expect(findings.some((f) => f.code === 'PW1' && f.message.includes('docs/tools.yml'))).toBe(true);
  });

  it('points at the offending item rather than at the file', () => {
    const text = FOUNDRY.replace('"unit-document"]', '"anywhere-really"]');
    const finding = errors(text)[0]!;
    const line = text.split('\n')[finding.line]!;
    expect(line).toContain('visibility');
    expect(line.slice(finding.column, finding.endColumn)).toBe('"anywhere-really"');
  });
});

describe('a declaration this reader cannot read', () => {
  it('reports the part it could not read rather than skipping it', () => {
    const findings = check(`${FOUNDRY}\nsurprise = 2026-09-13\n`);
    const toml = findings.find((f) => f.code === 'pathway-toml');
    expect(toml?.severity).toBe('error');
    expect(toml?.message).toContain('not a value this reader understands');
  });

  it('reports a multi-line array rather than reading half of it', () => {
    const findings = check(FOUNDRY.replace('approvals = ["dispatch", "land", "release"]', 'approvals = [\n  "dispatch",\n]'));
    expect(findings.some((f) => f.code === 'pathway-toml' && f.message.includes('multi-line'))).toBe(true);
  });
});

describe("argo-pack's own pathway declarations", () => {
  // The pack governs itself by the same law. Every file in docs/pathways is read, not a list of
  // the ones that were passing when somebody last looked.
  const DIR = join(ROOT, 'docs/pathways');
  const files = readdirSync(DIR)
    .filter((f) => f.endsWith('.toml'))
    .sort();

  it('are all there is, and every one declares an id matching its file name', () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const file of files) {
      const declaration = readPathway(`docs/pathways/${file}`, readFileSync(join(DIR, file), 'utf8'));
      expect(declaration.id).toBe(file.replace(/\.toml$/, ''));
    }
  });

  it.each(files)('%s satisfies the law against this workspace, which exposes neither join', (file) => {
    const declaration = readPathway(`docs/pathways/${file}`, readFileSync(join(DIR, file), 'utf8'));
    const findings = checkPathway(declaration, law({ surfaces: null, tools: null }));
    expect(findings.filter((f) => f.severity !== 'information')).toEqual([]);
    expect(countToFix(findings)).toBe(0);
  });

  it.each(files)('%s also satisfies it with both joins closed', (file) => {
    const declaration = readPathway(`docs/pathways/${file}`, readFileSync(join(DIR, file), 'utf8'));
    expect(checkPathway(declaration, law()).filter((f) => f.severity !== 'information')).toEqual([]);
  });
});

describe('namesFromYaml', () => {
  it('reads a sequence under the key', () => {
    expect(namesFromYaml('surfaces:\n  - a\n  - b\n', 'surfaces')).toEqual(new Set(['a', 'b']));
  });

  it('reads a bare sequence', () => {
    expect(namesFromYaml('- a\n- b\n', 'surfaces')).toEqual(new Set(['a', 'b']));
  });

  it('reads a mapping by its keys', () => {
    expect(namesFromYaml('a: one\nb: two\n', 'surfaces')).toEqual(new Set(['a', 'b']));
  });

  // Null, not an empty set: an empty set would make every name in a pathway an error.
  it('comes back null on a file it cannot make a list out of', () => {
    expect(namesFromYaml('', 'surfaces')).toBeNull();
    expect(namesFromYaml('\tbad: indent\n', 'surfaces')).toBeNull();
  });
});

describe('the assignment table, read lightly', () => {
  const declared = new Map<string, PathwayDeclaration>([
    ['foundry', readPathway('docs/pathways/foundry.toml', FOUNDRY)],
  ]);

  const FIXTURE = readFileSync(join(FIXTURES, 'assignment.toml'), 'utf8');

  it('is clean when the default names a declared pathway', () => {
    expect(checkAssignment(FIXTURE, declared, 'docs/pathways')).toEqual([]);
  });

  it('reads the flat shape too', () => {
    expect(checkAssignment('default_pathway = "foundry"\n', declared, 'docs/pathways')).toEqual([]);
  });

  it('errors when the default names a pathway nobody declared', () => {
    const findings = checkAssignment(FIXTURE.replace('"foundry"', '"improvised"'), declared, 'docs/pathways');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe('A1');
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.message).toContain('is not declared');
  });

  it('reports unknown when the workspace declares no pathways at all', () => {
    const findings = checkAssignment(FIXTURE, null, 'docs/pathways');
    expect(findings[0]?.severity).toBe('information');
    expect(findings[0]?.message).toContain('unknown, not clean');
  });

  // Lightly means lightly. Everything else in an assignment table is the operator's business.
  it('says nothing about a table that declares no default', () => {
    expect(checkAssignment('[defaults]\nttl = "P1D"\n', declared, 'docs/pathways')).toEqual([]);
  });
});
