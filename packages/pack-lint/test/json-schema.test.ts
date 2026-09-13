import { describe, expect, it } from 'vitest';
import { validate } from '../../../schemas/src/json-schema.js';

const messages = (value: unknown, schema: unknown): string[] =>
  validate(value, schema).map((e) => `${e.path}: ${e.message}`);

describe('validate', () => {
  it('accepts a value that satisfies the schema', () => {
    expect(validate({ a: 'x' }, { type: 'object', required: ['a'], properties: { a: { type: 'string' } } })).toEqual([]);
  });

  it('reports a wrong type at the right path', () => {
    expect(messages({ a: 1 }, { type: 'object', properties: { a: { type: 'string' } } })).toEqual([
      'a: expected string, found integer',
    ]);
  });

  it('reports a missing required property', () => {
    expect(messages({}, { type: 'object', required: ['a'] })).toEqual([': missing required property "a"']);
  });

  it('reports an unknown property when additionalProperties is false', () => {
    expect(messages({ a: 1, b: 2 }, { type: 'object', additionalProperties: false, properties: { a: {} } })).toEqual([
      'b: unknown property "b"',
    ]);
  });

  it('enforces enum, const and pattern', () => {
    expect(messages('c', { enum: ['a', 'b'] })).toHaveLength(1);
    expect(messages('b', { const: 'a' })).toHaveLength(1);
    expect(messages('Ab', { type: 'string', pattern: '^[a-z]+$' })).toHaveLength(1);
    expect(validate('a', { enum: ['a', 'b'] })).toEqual([]);
  });

  it('enforces array constraints including uniqueItems', () => {
    expect(messages(['a', 'a'], { type: 'array', uniqueItems: true })).toEqual(['1: duplicate of item 0 ("a")']);
    expect(messages([], { type: 'array', minItems: 1 })).toHaveLength(1);
    expect(messages(['a', 1], { type: 'array', items: { type: 'string' } })).toEqual([
      '1: expected string, found integer',
    ]);
  });

  it('distinguishes integer from number', () => {
    expect(validate(1, { type: 'integer' })).toEqual([]);
    expect(validate(1.5, { type: 'number' })).toEqual([]);
    expect(messages(1.5, { type: 'integer' })).toEqual([': expected integer, found number']);
    expect(validate(1, { type: 'number' })).toEqual([]);
  });

  it('resolves a local $ref', () => {
    const schema = {
      $defs: { id: { type: 'string', pattern: '^x-' } },
      type: 'object',
      properties: { a: { $ref: '#/$defs/id' } },
    };
    expect(validate({ a: 'x-one' }, schema)).toEqual([]);
    expect(messages({ a: 'y' }, schema)).toEqual(['a: "y" does not match "^x-"']);
  });

  it('handles anyOf and oneOf', () => {
    const anyOf = { anyOf: [{ type: 'string' }, { type: 'integer' }] };
    expect(validate('a', anyOf)).toEqual([]);
    expect(validate(1, anyOf)).toEqual([]);
    expect(messages(1.5, anyOf)).toHaveLength(1);

    const oneOf = { oneOf: [{ type: 'string' }, { type: 'string', minLength: 3 }] };
    expect(messages('abcd', oneOf)).toEqual([': "abcd" matches 2 shapes where exactly one is permitted']);
  });

  // The reason this validator exists rather than a general one: when it cannot fully honour a
  // schema it has to say so, because law-plank reads schemas out of workspaces it did not write.
  it('reports an unsupported keyword rather than ignoring it', () => {
    const errors = validate({ a: 1 }, { type: 'object', propertyNames: { pattern: '^a$' } });
    expect(errors).toHaveLength(1);
    expect(errors[0]?.unsupported).toBe(true);
    expect(errors[0]?.message).toContain('propertyNames');
  });

  it('reports an unresolvable $ref rather than passing the value', () => {
    const errors = validate('x', { $ref: '#/$defs/missing' });
    expect(errors).toHaveLength(1);
    expect(errors[0]?.unsupported).toBe(true);
  });

  it('reports a non-object schema rather than passing the value', () => {
    expect(validate('x', null)[0]?.unsupported).toBe(true);
  });
});
