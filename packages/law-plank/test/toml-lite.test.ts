/**
 * The TOML reader.
 *
 * Half of these tests are about what it refuses. That is the point of it: a reader that quietly
 * skipped a construct it did not implement would make every pathway check downstream pass for
 * the wrong reason, and a pathway declaration is not a file it is safe to half-read.
 */

import { describe, expect, it } from 'vitest';
import { parseTomlLite } from '../src/toml-lite.js';

const clean = (text: string): Record<string, unknown> => {
  const parsed = parseTomlLite(text);
  expect(parsed.problems).toEqual([]);
  return parsed.value;
};

describe('what it reads', () => {
  it('reads bare key-value pairs', () => {
    expect(clean('id = "foundry"\nttl = "P14D"\n')).toEqual({ id: 'foundry', ttl: 'P14D' });
  });

  it('reads integers, floats and booleans', () => {
    expect(clean('seq = 41\nrate = 1.5\nopen = true\nshut = false\n')).toEqual({
      seq: 41,
      rate: 1.5,
      open: true,
      shut: false,
    });
  });

  it('reads single-line arrays', () => {
    expect(clean('approvals = ["dispatch", "land"]\nnone = []\n')).toEqual({
      approvals: ['dispatch', 'land'],
      none: [],
    });
  });

  it('reads literal strings without unescaping them', () => {
    expect(clean(`path = 'a\\b'\n`)).toEqual({ path: 'a\\b' });
  });

  it('unescapes a basic string', () => {
    expect(clean('halt = "a \\"red\\" check"\n')).toEqual({ halt: 'a "red" check' });
  });

  it('reads a [table]', () => {
    expect(clean('[defaults]\npathway = "foundry"\n')).toEqual({ defaults: { pathway: 'foundry' } });
  });

  it('reads a [[table]] as an array, in order', () => {
    const value = clean('[[stages]]\nname = "dispatch"\n\n[[stages]]\nname = "land"\n');
    expect(value).toEqual({ stages: [{ name: 'dispatch' }, { name: 'land' }] });
  });

  it('ignores comments and blank lines, including one after a value', () => {
    expect(clean('# a comment\n\nid = "x"  # and another\n')).toEqual({ id: 'x' });
  });

  it('does not treat a # inside a string as a comment', () => {
    expect(clean('note = "a # b"\n')).toEqual({ note: 'a # b' });
  });
});

describe('where it points', () => {
  const text = 'id = "foundry"\napprovals = ["dispatch", "land"]\n\n[[stages]]\nname = "land"\n';
  const { positions } = parseTomlLite(text);

  it('points at a key', () => {
    expect(positions.get('id')).toEqual({ line: 0, col: 0, endCol: 2 });
  });

  it('points at each item of an array', () => {
    const second = positions.get('approvals.1')!;
    expect(second.line).toBe(1);
    expect(text.split('\n')[1]!.slice(second.col, second.endCol)).toBe('"land"');
  });

  it('points at a key inside an array of tables', () => {
    expect(positions.get('stages.0.name')?.line).toBe(4);
  });
});

describe('what it refuses, out loud', () => {
  const problems = (text: string): string[] => parseTomlLite(text).problems.map((p) => p.message);

  it('refuses a multi-line array rather than reading the first line of it', () => {
    expect(problems('approvals = [\n  "dispatch",\n]\n')[0]).toContain('multi-line array');
  });

  it('refuses an inline table', () => {
    expect(problems('stage = { name = "land" }\n')[0]).toContain('inline table');
  });

  it('refuses a multi-line string', () => {
    expect(problems('gist = """\nlong\n"""\n')[0]).toContain('multi-line string');
  });

  it('refuses a date, which is a TOML type this reader does not carry', () => {
    expect(problems('created = 2026-09-13\n')[0]).toContain('not a value this reader understands');
  });

  it('refuses a dotted table name', () => {
    expect(problems('[a.b]\nx = 1\n')[0]).toContain('bare [name] table');
  });

  it('refuses a line that is not a pair or a header', () => {
    expect(problems('just some words\n')[0]).toContain('expected `key = value`');
  });

  it('refuses an unterminated string', () => {
    expect(problems('id = "foundry\n')[0]).toContain('never closed');
  });

  it('refuses a key with no value', () => {
    expect(problems('id =\n')[0]).toContain('no value');
  });

  it('notices a key set twice in the same table', () => {
    expect(problems('id = "a"\nid = "b"\n')[0]).toContain('more than once');
  });

  it('notices a table defined twice', () => {
    expect(problems('[a]\nx = 1\n[a]\ny = 2\n')[0]).toContain('more than once');
  });

  it('reports every problem it found, in the order they appear', () => {
    const found = parseTomlLite('oops\nid = "x"\nalso oops\n');
    expect(found.problems.map((p) => p.line)).toEqual([0, 2]);
    // What it could read, it still read.
    expect(found.value['id']).toBe('x');
  });
});
