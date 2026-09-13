/**
 * Pathway declarations, and the assignment table that picks a default among them.
 *
 * A pathway says how work reaches a person: what it may affect, what validates it, where
 * somebody gets a say, who can see it, what it may spend, how long it stands, and the stages it
 * moves through. `docs/pathways/*.toml` is where a workspace writes that down, and this file is
 * what reads it.
 *
 * Three things are worth saying about the shape of the checks.
 *
 * **The vocabulary belongs to the workspace.** The enums — `effects`, `validation` — and the
 * `posture_budget` pattern live in the workspace's own `docs/schema/pathway.schema.json`, read
 * at runtime. This plank carries no copy and no second opinion about what a pathway may say. If
 * the workspace has no pathway schema, that is reported as unknown, not as a pass.
 *
 * **The joins go as far as the workspace exposes them, and no further.** A stage's `verbs` can be
 * checked against a tool manifest if the workspace publishes one; `visibility` can be checked
 * against `docs/surfaces.yml` if it has one. Where the workspace exposes neither, the finding is
 * INFO and says "unknown" — never a silent pass, and never a hard failure for something the
 * author had no way to satisfy.
 *
 * **Some things cannot be checked at author time at all.** `posture_budget` and `approvals` are
 * resolved by the operator's own side, against state this plank cannot see and should not want
 * to. That is said out loud, once per declaration, as INFO.
 *
 * Nothing in this file imports `vscode`.
 */

import { validate, type ValidationError } from './json-schema.js';
import { parseTomlLite, type TomlProblem } from './toml-lite.js';
import { parseYamlLite, YamlLiteError } from './yaml-lite.js';
import {
  START,
  isObject,
  inReadingOrder,
  positionIn,
  stringList,
  type LawFinding,
} from './finding.js';
import type { Pos } from './yaml-lite.js';

/** One `docs/pathways/*.toml`, as read. */
export interface PathwayDeclaration {
  /** Where it came from, relative to the workspace root. */
  readonly file: string;
  /** The id it declares, or `null` when it declares none this reader can use. */
  readonly id: string | null;
  /** The human words this pathway offers. C7 holds a unit's `human_word` inside this set. */
  readonly approvals: readonly string[];
  readonly value: Record<string, unknown>;
  readonly positions: ReadonlyMap<string, Pos>;
  readonly problems: readonly TomlProblem[];
}

/** The parts of the workspace a pathway declaration is checked against. */
export interface PathwayLaw {
  /** Parsed `docs/schema/pathway.schema.json`, or `null` when the workspace has none. */
  readonly pathwaySchema: unknown;
  readonly pathwaySchemaPath: string;
  /** Surface names from `docs/surfaces.yml`, or `null` when the workspace has none. */
  readonly surfaces: ReadonlySet<string> | null;
  readonly surfacesPath: string;
  /** Tool names from the workspace's tool manifest, or `null` when it publishes none. */
  readonly tools: ReadonlySet<string> | null;
  readonly toolsPath: string;
}

export function readPathway(file: string, text: string): PathwayDeclaration {
  const { value, positions, problems } = parseTomlLite(text);
  const id = typeof value['id'] === 'string' && value['id'] !== '' ? value['id'] : null;
  return { file, id, approvals: stringList(value['approvals']), value, positions, problems };
}

/**
 * The names a workspace lists in a small YAML file.
 *
 * Three shapes are accepted, because a workspace that keeps a list of surfaces has not
 * necessarily agreed with anybody about how to write one down: a bare sequence, a sequence under
 * `key`, or a mapping whose keys are the names. Anything else reads as no list at all, and the
 * caller reports that as unknown rather than as an empty set.
 */
export function namesFromYaml(text: string, key: string): Set<string> | null {
  let parsed: unknown;
  try {
    parsed = parseYamlLite(text).value;
  } catch (err) {
    if (err instanceof YamlLiteError) return null;
    throw err;
  }
  if (Array.isArray(parsed)) return new Set(stringList(parsed));
  if (!isObject(parsed)) return null;
  const under = parsed[key];
  if (Array.isArray(under)) return new Set(stringList(under));
  const keys = Object.keys(parsed);
  return keys.length === 0 ? null : new Set(keys);
}

function schemaFindings(declaration: PathwayDeclaration, law: PathwayLaw): LawFinding[] {
  if (law.pathwaySchema === null || law.pathwaySchema === undefined) {
    return [
      {
        code: 'pathway-schema-unknown',
        severity: 'information',
        message: `no ${law.pathwaySchemaPath} in this workspace, so this pathway was not validated — unknown, not clean. law-plank reads the workspace's own schema and never carries one.`,
        ...START,
      },
    ];
  }

  const errors: ValidationError[] = validate(declaration.value, law.pathwaySchema);
  return errors.map((error) => {
    const at = positionIn(declaration.positions, error.path);
    if (error.unsupported === true) {
      return {
        code: 'pathway-schema-unknown' as const,
        severity: 'warning' as const,
        message: `${law.pathwaySchemaPath} uses something law-plank cannot check (${error.message}) — this part of the declaration is unknown, not clean`,
        ...at,
      };
    }
    return {
      code: 'pathway-schema' as const,
      severity: 'error' as const,
      message: error.path === '' ? error.message : `${error.path}: ${error.message}`,
      ...at,
    };
  });
}

/** `verbs[]` against a tool manifest, if the workspace publishes one. */
function verbFindings(declaration: PathwayDeclaration, law: PathwayLaw): LawFinding[] {
  const stages = declaration.value['stages'];
  if (!Array.isArray(stages)) return [];

  const findings: LawFinding[] = [];
  let anyVerb = false;

  stages.forEach((stage, stageIndex) => {
    if (!isObject(stage)) return;
    const verbs = stage['verbs'];
    if (!Array.isArray(verbs)) return;
    verbs.forEach((verb, verbIndex) => {
      if (typeof verb !== 'string') return;
      anyVerb = true;
      if (law.tools === null || law.tools.has(verb)) return;
      findings.push({
        code: 'PW1',
        severity: 'error',
        message: `PW1: the \`${String(stage['name'] ?? stageIndex)}\` stage reaches for \`${verb}\`, which ${law.toolsPath} does not list — a stage may only name a verb this workspace publishes`,
        ...positionIn(declaration.positions, `stages.${stageIndex}.verbs.${verbIndex}`),
      });
    });
  });

  if (law.tools === null && anyVerb) {
    findings.push({
      code: 'PW1',
      severity: 'information',
      message: `PW1: this workspace publishes no ${law.toolsPath}, so the verbs these stages reach for are unknown — not verified, and not a pass`,
      ...positionIn(declaration.positions, 'stages.0'),
    });
  }

  return findings;
}

/** `visibility[]` against `docs/surfaces.yml`, if the workspace has one. */
function visibilityFindings(declaration: PathwayDeclaration, law: PathwayLaw): LawFinding[] {
  const visibility = declaration.value['visibility'];
  if (!Array.isArray(visibility)) return [];

  if (law.surfaces === null) {
    return visibility.length === 0
      ? []
      : [
          {
            code: 'PW1',
            severity: 'information',
            message: `PW1: this workspace has no ${law.surfacesPath}, so the surfaces this pathway is visible on are unknown — not verified, and not a pass`,
            ...positionIn(declaration.positions, 'visibility'),
          },
        ];
  }

  const surfaces = law.surfaces;
  const findings: LawFinding[] = [];
  visibility.forEach((surface, index) => {
    if (typeof surface !== 'string' || surfaces.has(surface)) return;
    findings.push({
      code: 'PW1',
      severity: 'error',
      message: `PW1: \`${surface}\` is not a surface — ${law.surfacesPath} lists ${[...surfaces].sort().join(', ')}, and a pathway cannot be visible somewhere the workspace does not have`,
      ...positionIn(declaration.positions, `visibility.${index}`),
    });
  });
  return findings;
}

/**
 * The two fields nobody can check from here.
 *
 * `posture_budget` resolves against the operator's own budget, and `approvals` against whoever
 * is actually available to give one. Both are private to the side that runs the pathway. Saying
 * so once, as information, is the honest alternative to a check that would always pass.
 */
function notVerifiableFindings(declaration: PathwayDeclaration): LawFinding[] {
  const budget = declaration.value['posture_budget'];
  if (budget === undefined) return [];
  return [
    {
      code: 'PW2',
      severity: 'information',
      message:
        'PW2: `posture_budget` and `approvals` resolve on the operator\'s side, against a budget and a roster this plank cannot see — they are not verifiable at author time',
      ...positionIn(declaration.positions, 'posture_budget'),
    },
  ];
}

export function checkPathway(declaration: PathwayDeclaration, law: PathwayLaw): LawFinding[] {
  const findings: LawFinding[] = declaration.problems.map((problem) => ({
    code: 'pathway-toml' as const,
    severity: 'error' as const,
    message: `this declaration could not be read: ${problem.message}`,
    line: problem.line,
    column: 0,
    endColumn: 80,
  }));

  findings.push(
    ...schemaFindings(declaration, law),
    ...verbFindings(declaration, law),
    ...visibilityFindings(declaration, law),
    ...notVerifiableFindings(declaration),
  );

  return inReadingOrder(findings);
}

/**
 * The assignment table, read lightly.
 *
 * `assignment.toml` says which pathway work takes when nothing else says otherwise. The one
 * thing worth checking from here is that the default it names is a pathway the workspace has
 * actually declared — everything else in that file is the operator's business.
 */
export function checkAssignment(
  text: string,
  pathways: ReadonlyMap<string, PathwayDeclaration> | null,
  pathwaysDir: string,
): LawFinding[] {
  const { value, positions, problems } = parseTomlLite(text);

  const findings: LawFinding[] = problems.map((problem) => ({
    code: 'pathway-toml' as const,
    severity: 'error' as const,
    message: `this assignment table could not be read: ${problem.message}`,
    line: problem.line,
    column: 0,
    endColumn: 80,
  }));

  // Two shapes are accepted, because both are in use and neither is wrong.
  const defaults = value['defaults'];
  const direct = value['default_pathway'];
  const nested = isObject(defaults) ? defaults['pathway'] : undefined;
  const declared = typeof direct === 'string' ? direct : typeof nested === 'string' ? nested : null;
  const path = typeof direct === 'string' ? 'default_pathway' : 'defaults.pathway';

  if (declared === null) return inReadingOrder(findings);

  if (pathways === null) {
    findings.push({
      code: 'A1',
      severity: 'information',
      message: `A1: this workspace has no ${pathwaysDir}/, so the default pathway \`${declared}\` resolves to nothing readable — unknown, not clean`,
      ...positionIn(positions, path),
    });
    return inReadingOrder(findings);
  }

  if (!pathways.has(declared)) {
    findings.push({
      code: 'A1',
      severity: 'error',
      message: `A1: the default pathway \`${declared}\` is not declared — no file in ${pathwaysDir}/ declares that id, so work assigned by default would run on a pathway nobody has written down`,
      ...positionIn(positions, path),
    });
  }

  return inReadingOrder(findings);
}
