import { describe, expect, it } from 'vitest';
import { parseFrontMatter } from '../src/front-matter.js';

describe('parseFrontMatter', () => {
  it('reads a fenced block and records where it is', () => {
    const fm = parseFrontMatter('---\nid: 0001-x\n---\n\n# Body\n');
    expect(fm.value).toEqual({ id: '0001-x' });
    expect(fm.range).toEqual({ openLine: 0, closeLine: 2, firstContentLine: 1 });
    expect(fm.error).toBeUndefined();
  });

  it('offsets positions by the fence, so they point into the real document', () => {
    const fm = parseFrontMatter('---\nid: 0001-x\ntitle: x\n---\n');
    expect(fm.positions.get('title')?.line).toBe(2);
  });

  it('tolerates blank lines before the opening fence', () => {
    expect(parseFrontMatter('\n\n---\nid: 0001-x\n---\n').range?.openLine).toBe(2);
  });

  it('reports no block at all', () => {
    const fm = parseFrontMatter('# Just a heading\n');
    expect(fm.range).toBeNull();
    expect(fm.error).toBeUndefined();
  });

  it('reports an unclosed block', () => {
    const fm = parseFrontMatter('---\nid: 0001-x\n');
    expect(fm.error?.message).toContain('never closed');
    expect(fm.error?.line).toBe(0);
  });

  it('treats an empty block as an empty mapping, not as absent', () => {
    const fm = parseFrontMatter('---\n---\n# Body\n');
    expect(fm.value).toEqual({});
    expect(fm.range).not.toBeNull();
  });

  it('describes unreadable YAML rather than throwing', () => {
    const fm = parseFrontMatter('---\nid: 0001-x\n\tbad: indent\n---\n');
    expect(fm.error).toBeDefined();
    expect(fm.error?.line).toBe(2);
    expect(fm.value).toBeNull();
  });

  it('handles CRLF line endings', () => {
    expect(parseFrontMatter('---\r\nid: 0001-x\r\n---\r\n').value).toEqual({ id: '0001-x' });
  });

  it('does not mistake a horizontal rule further down for the opening fence', () => {
    const fm = parseFrontMatter('# Heading\n\n---\n\nmore prose\n');
    expect(fm.range).toBeNull();
  });
});
