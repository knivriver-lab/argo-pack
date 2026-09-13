/**
 * What the quick fixes write.
 *
 * Each test applies the returned edit to the document text and asserts on the result, rather
 * than asserting on offsets. An edit that is right about its offsets but wrong about the file it
 * produces is still wrong, and this is the form that catches that.
 */

import { describe, expect, it } from 'vitest';
import { parseFrontMatter } from '../src/front-matter.js';
import { parseDepsToml } from '../src/deps-toml.js';
import { resolveAddDepsEntry, resolveFix, type PlainEdit } from '../src/fixes.js';

function apply(text: string, edit: PlainEdit): string {
  const lines = text.split('\n');
  const offsetOf = (line: number, column: number): number => {
    let offset = 0;
    for (let i = 0; i < line; i++) offset += (lines[i]?.length ?? 0) + 1;
    return offset + column;
  };
  const start = offsetOf(edit.startLine, edit.startColumn);
  const end = offsetOf(edit.endLine, edit.endColumn);
  return text.slice(0, start) + edit.newText + text.slice(end);
}

const UNIT = `---
id: 0001-a-unit
pathway: foundry
human_word:
  - dispatch
weight: W2
---

## Spec
`;

function fixUnit(text: string, fix: Parameters<typeof resolveFix>[0], depsText: string | null = null): string {
  const fm = parseFrontMatter(text);
  const resolved = resolveFix(fix, text, fm, depsText);
  if (resolved === null || resolved.target !== 'document') throw new Error('expected an edit to the document');
  return apply(text, resolved.edit);
}

describe('add a human word', () => {
  it('appends to an existing block sequence, keeping its indentation', () => {
    expect(fixUnit(UNIT, { title: '', kind: 'add-human-word', word: 'land' })).toContain(
      'human_word:\n  - dispatch\n  - land\nweight: W2',
    );
  });

  it('keeps the document readable by the same parser afterwards', () => {
    const after = fixUnit(UNIT, { title: '', kind: 'add-human-word', word: 'land' });
    expect((parseFrontMatter(after).value as { human_word: string[] }).human_word).toEqual(['dispatch', 'land']);
  });

  it('extends a flow sequence in place', () => {
    const text = UNIT.replace('human_word:\n  - dispatch\n', 'human_word: [dispatch]\n');
    const after = fixUnit(text, { title: '', kind: 'add-human-word', word: 'land' });
    expect(after).toContain('human_word: [dispatch, land]');
    expect((parseFrontMatter(after).value as { human_word: string[] }).human_word).toEqual(['dispatch', 'land']);
  });

  it('fills an empty flow sequence', () => {
    const text = UNIT.replace('human_word:\n  - dispatch\n', 'human_word: []\n');
    expect(fixUnit(text, { title: '', kind: 'add-human-word', word: 'land' })).toContain('human_word: [land]');
  });

  it('adds the key itself when the document has none', () => {
    const text = UNIT.replace('human_word:\n  - dispatch\n', '');
    const after = fixUnit(text, { title: '', kind: 'add-human-word', word: 'land' });
    expect((parseFrontMatter(after).value as { human_word: string[] }).human_word).toEqual(['land']);
    expect(after).toContain('## Spec');
  });

  it('fills a key that has nothing under it', () => {
    const text = UNIT.replace('human_word:\n  - dispatch\n', 'human_word:\n');
    const after = fixUnit(text, { title: '', kind: 'add-human-word', word: 'land' });
    expect((parseFrontMatter(after).value as { human_word: string[] }).human_word).toEqual(['land']);
  });
});

describe('insert the design_ref skeleton', () => {
  it('writes only the keys that were asked for', () => {
    const after = fixUnit(UNIT, { title: '', kind: 'insert-design-ref', missing: ['deliverables'] });
    expect(after).toContain('deliverables:\n  - TODO');
    expect(after).not.toContain('design_ref:');
  });

  it('writes both when both are missing, above the closing fence', () => {
    const after = fixUnit(UNIT, { title: '', kind: 'insert-design-ref', missing: ['design_ref', 'deliverables'] });
    const parsed = parseFrontMatter(after).value as { design_ref: string; deliverables: string[] };
    expect(parsed.design_ref).toBe('TODO');
    expect(parsed.deliverables).toEqual(['TODO']);
    expect(after).toContain('## Spec');
  });

  it('leaves the prose below the fence untouched', () => {
    const after = fixUnit(UNIT, { title: '', kind: 'insert-design-ref', missing: ['design_ref'] });
    expect(after.slice(after.indexOf('---', 4))).toBe('---\n\n## Spec\n');
  });
});

describe('record a dependency edge', () => {
  it('appends to an existing deps.toml', () => {
    const existing = '[[edge]]\nfrom = "0001-a-unit"\nto = "0002-other"\n';
    const fix = resolveAddDepsEntry(existing, '0001-a-unit', '0003-third');
    expect(fix.createdFile).toBe(false);
    const parsed = parseDepsToml(fix.contents);
    expect(parsed.problems).toEqual([]);
    expect(parsed.edges.map((e) => `${e.from}->${e.to}`)).toEqual(['0001-a-unit->0002-other', '0001-a-unit->0003-third']);
  });

  it('creates the file, with its explanation, when there is none', () => {
    const fix = resolveAddDepsEntry(null, '0001-a-unit', '0002-other');
    expect(fix.createdFile).toBe(true);
    expect(fix.contents).toContain('# The dependency edges');
    expect(parseDepsToml(fix.contents).edges).toHaveLength(1);
  });

  it('copes with a file that does not end in a newline', () => {
    const fix = resolveAddDepsEntry('[[edge]]\nfrom = "a"\nto = "b"', 'a', 'c');
    expect(parseDepsToml(fix.contents).problems).toEqual([]);
    expect(parseDepsToml(fix.contents).edges).toHaveLength(2);
  });

  it('quotes ids, so an id with a quote in it cannot break the file', () => {
    const fix = resolveAddDepsEntry(null, 'a"b', 'c');
    expect(parseDepsToml(fix.contents).edges[0]?.from).toBe('a"b');
  });
});

describe('a fix descriptor that is missing its arguments', () => {
  it('resolves to nothing rather than to a wrong edit', () => {
    const fm = parseFrontMatter(UNIT);
    expect(resolveFix({ title: '', kind: 'add-human-word' }, UNIT, fm, null)).toBeNull();
    expect(resolveFix({ title: '', kind: 'add-deps-entry', from: 'a' }, UNIT, fm, null)).toBeNull();
    expect(resolveFix({ title: '', kind: 'insert-resolution-skeleton' }, UNIT, fm, null)).toBeNull();
    expect(resolveFix({ title: '', kind: 'insert-claim-block', fields: [] }, UNIT, fm, null)).toBeNull();
  });
});
