import { describe, expect, it } from 'vitest';
import { hasEdge, parseDepsToml, renderEdge } from '../src/deps-toml.js';

describe('parseDepsToml', () => {
  it('reads edges', () => {
    const { edges, problems } = parseDepsToml('[[edge]]\nfrom = "a"\nto = "b"\n\n[[edge]]\nfrom = "b"\nto = "c"\n');
    expect(problems).toEqual([]);
    expect(edges.map((e) => `${e.from}->${e.to}`)).toEqual(['a->b', 'b->c']);
  });

  it('records the line of each edge, so a finding can point at it', () => {
    expect(parseDepsToml('\n[[edge]]\nfrom = "a"\nto = "b"\n').edges[0]?.line).toBe(1);
  });

  it('ignores comments and blank lines', () => {
    expect(parseDepsToml('# a note\n\n[[edge]]\nfrom = "a"  # inline\nto = "b"\n').edges).toHaveLength(1);
  });

  it('accepts an empty file', () => {
    expect(parseDepsToml('# nothing yet\n')).toEqual({ edges: [], problems: [] });
  });

  it('reports an incomplete edge instead of dropping it', () => {
    const { edges, problems } = parseDepsToml('[[edge]]\nfrom = "a"\n');
    expect(edges).toEqual([]);
    expect(problems[0]?.message).toContain('both `from` and `to`');
  });

  it('reports a key outside any table', () => {
    expect(parseDepsToml('from = "a"\n').problems[0]?.message).toContain('outside any [[edge]] table');
  });

  it('reports an unknown key rather than ignoring it', () => {
    expect(parseDepsToml('[[edge]]\nfrom = "a"\nto = "b"\nwhy = "c"\n').problems[0]?.message).toContain('unknown key');
  });

  // A TOML feature we silently skipped would make C6 pass for the wrong reason.
  it('reports a table shape it does not understand', () => {
    expect(parseDepsToml('[units.a]\ndeps = []\n').problems[0]?.message).toContain('only [[edge]] tables');
  });

  it('requires values to be quoted, and then does not count the edge', () => {
    const { edges, problems } = parseDepsToml('[[edge]]\nfrom = a\nto = "b"\n');
    expect(problems.map((p) => p.message)).toContainEqual(expect.stringContaining('quoted string'));
    expect(edges).toEqual([]);
  });

  it('keeps a hash inside a quoted value', () => {
    expect(parseDepsToml('[[edge]]\nfrom = "a#1"\nto = "b"\n').edges[0]?.from).toBe('a#1');
  });
});

describe('hasEdge', () => {
  it('is directional', () => {
    const deps = parseDepsToml('[[edge]]\nfrom = "a"\nto = "b"\n');
    expect(hasEdge(deps, 'a', 'b')).toBe(true);
    expect(hasEdge(deps, 'b', 'a')).toBe(false);
  });
});

describe('renderEdge', () => {
  it('round-trips through the parser', () => {
    const { edges, problems } = parseDepsToml(renderEdge('0001-one', '0002-two'));
    expect(problems).toEqual([]);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.from).toBe('0001-one');
  });
});
