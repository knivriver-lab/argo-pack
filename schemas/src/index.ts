import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export { parseYamlLite, YamlLiteError } from './yaml-lite.js';
export type { ParsedYaml, Pos } from './yaml-lite.js';
export { validate } from './json-schema.js';
export type { ValidationError } from './json-schema.js';

/** Absolute path to the plank manifest schema shipped with this package. */
export const PLANK_SCHEMA_PATH = join(__dirname, '..', 'plank.schema.json');

let cached: unknown;

/** The plank manifest schema. This one belongs to the pack, so loading it from disk is fine. */
export function loadPlankSchema(): unknown {
  cached ??= JSON.parse(readFileSync(PLANK_SCHEMA_PATH, 'utf8')) as unknown;
  return cached;
}

/**
 * The closed sets the schema publishes, re-exported so the lint can explain a failure in terms
 * of what *is* allowed rather than only that the value was not.
 */
export const PUBLIC_KEELS = ['mewd'] as const;

export const UPSTREAM_POINTS = [
  'mcp-registration',
  'diagnostics',
  'code-actions',
  'session-provider',
  'open-vsx',
] as const;

export const AFFORDANCE_CLASSES = ['render-only', 'effect-surfacing'] as const;

/** There is no other permitted value, and no flag that changes it. */
export const TERMINAL_DECLARATION = 'NEVER-DECLARED';

export type Keel = (typeof PUBLIC_KEELS)[number];
export type UpstreamPoint = (typeof UPSTREAM_POINTS)[number];
export type AffordanceClass = (typeof AFFORDANCE_CLASSES)[number];

export interface PlankManifest {
  plank: string;
  face: string;
  keel: Keel;
  consumes: { mcp_tools: string[]; mcp_streams: string[] };
  affordance_class: AffordanceClass;
  state_policy: 'cache-only';
  swap_invariant: 'install-uninstall';
  upstream: UpstreamPoint[];
  terminal: typeof TERMINAL_DECLARATION;
  schema: 1;
}
