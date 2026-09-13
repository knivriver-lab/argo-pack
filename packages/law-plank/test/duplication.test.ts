/**
 * The two readers exist twice on purpose.
 *
 * An extension bundle has to be self-contained — `law-plank` cannot reach into a workspace
 * package at runtime — so `yaml-lite.ts` and `json-schema.ts` are copied into it verbatim. A copy
 * that can drift is a liability; a copy that cannot is just a copy. This is what makes the
 * difference, and it is cheap enough to be worth it.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const shared = (name: string): string => readFileSync(join(__dirname, '../../../schemas/src', name), 'utf8');
const copied = (name: string): string => readFileSync(join(__dirname, '../src', name), 'utf8');

describe('the deliberate copies', () => {
  it.each(['yaml-lite.ts', 'json-schema.ts'])('%s is byte-identical to the one in schemas/src', (name) => {
    expect(copied(name)).toBe(shared(name));
  });

  it.each(['yaml-lite.ts', 'json-schema.ts'])('%s says why it is duplicated', (name) => {
    expect(copied(name)).toContain('byte-identical');
  });
});
