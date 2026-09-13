import { describe, expect, it } from 'vitest';
import { parseYamlLite, YamlLiteError } from '../../../schemas/src/yaml-lite.js';

describe('parseYamlLite', () => {
  it('reads a block map', () => {
    const { value } = parseYamlLite('plank: mewd.law-plank\nface: A6-working\nschema: 1\n');
    expect(value).toEqual({ plank: 'mewd.law-plank', face: 'A6-working', schema: 1 });
  });

  it('reads a block sequence under a key', () => {
    const { value } = parseYamlLite('upstream:\n  - diagnostics\n  - code-actions\n');
    expect(value).toEqual({ upstream: ['diagnostics', 'code-actions'] });
  });

  it('reads nested maps', () => {
    const { value } = parseYamlLite('consumes:\n  mcp_tools:\n    - propose\n  mcp_streams: []\n');
    expect(value).toEqual({ consumes: { mcp_tools: ['propose'], mcp_streams: [] } });
  });

  it('reads empty and populated flow collections', () => {
    expect(parseYamlLite('a: []\nb: {}\nc: [one, two]\n').value).toEqual({
      a: [],
      b: {},
      c: ['one', 'two'],
    });
  });

  it('reads scalars by type', () => {
    const { value } = parseYamlLite('s: text\nn: 42\nf: -1.5\nt: true\nf2: false\nnil:\ntilde: ~\n');
    expect(value).toEqual({ s: 'text', n: 42, f: -1.5, t: true, f2: false, nil: null, tilde: null });
  });

  it('keeps a quoted scalar verbatim, including a hash', () => {
    expect(parseYamlLite('a: "has # inside"\nb: \'single\'\n').value).toEqual({
      a: 'has # inside',
      b: 'single',
    });
  });

  it('strips comments outside quotes', () => {
    expect(parseYamlLite('# leading\na: one   # trailing\n').value).toEqual({ a: 'one' });
  });

  it('ignores document markers, so front matter can be handed to it directly', () => {
    expect(parseYamlLite('---\na: one\n---\n').value).toEqual({ a: 'one' });
  });

  it('records the line each key came from, offset by the caller', () => {
    const { positions } = parseYamlLite('a: 1\nb:\n  - x\n', 10);
    expect(positions.get('a')?.line).toBe(10);
    expect(positions.get('b')?.line).toBe(11);
    expect(positions.get('b.0')?.line).toBe(12);
  });

  it('rejects a tab used for indentation rather than guessing', () => {
    expect(() => parseYamlLite('a:\n\t- one\n')).toThrow(YamlLiteError);
  });

  it('rejects an unterminated quoted scalar', () => {
    expect(() => parseYamlLite('a: [ "one ]\n')).toThrow(YamlLiteError);
  });

  it('rejects a line that is neither a key nor a sequence item', () => {
    expect(() => parseYamlLite('just some prose\n')).toThrow(YamlLiteError);
  });

  it('returns null for an empty document', () => {
    expect(parseYamlLite('\n\n# only a comment\n').value).toBeNull();
  });
});
