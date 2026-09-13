/**
 * A JSON Schema validator covering the subset this pack is willing to rely on.
 *
 * Supported: `type`, `enum`, `const`, `required`, `properties`, `additionalProperties`,
 * `items`, `minItems`, `maxItems`, `uniqueItems`, `minLength`, `maxLength`, `pattern`,
 * `minimum`, `maximum`, `allOf`, `anyOf`, `oneOf`, and local `$ref` into `$defs`/`definitions`.
 *
 * A keyword outside that set is reported as `unsupported`, never silently ignored — a schema
 * this validator cannot fully honour must not be able to pass by accident. That matters most
 * for `law-plank`, which reads a schema out of somebody else's workspace: if we cannot check
 * it, we say so rather than pretending the document is clean.
 *
 * This file exists twice: here, and verbatim at `packages/law-plank/src/json-schema.ts`. An
 * extension bundle has to be self-contained — it cannot reach into a workspace package at
 * runtime — so the copy is deliberate. `test/duplication.test.ts` asserts the two are
 * byte-identical, which turns a copy that could drift into one that cannot.
 */

export interface ValidationError {
  /** Dotted path to the offending value, `` for the document root. */
  readonly path: string;
  readonly message: string;
  /** Set when the schema itself used something this validator does not implement. */
  readonly unsupported?: boolean;
}

const SUPPORTED = new Set([
  '$schema',
  '$id',
  '$ref',
  '$defs',
  '$comment',
  'definitions',
  'title',
  'description',
  'default',
  'examples',
  'deprecated',
  'type',
  'enum',
  'const',
  'required',
  'properties',
  'additionalProperties',
  'items',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minLength',
  'maxLength',
  'pattern',
  'minimum',
  'maximum',
  'allOf',
  'anyOf',
  'oneOf',
]);

type Schema = Record<string, unknown>;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function typeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

function typeMatches(value: unknown, want: string): boolean {
  const actual = typeOf(value);
  if (want === 'number') return actual === 'number' || actual === 'integer';
  return actual === want;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  if (isObject(a) && isObject(b)) {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    return ka.length === kb.length && ka.every((k, i) => k === kb[i]) && ka.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

function show(v: unknown): string {
  const s = JSON.stringify(v);
  return s === undefined ? String(v) : s.length > 60 ? `${s.slice(0, 57)}...` : s;
}

function join(path: string, key: string | number): string {
  return path === '' ? String(key) : `${path}.${key}`;
}

function resolveRef(root: Schema, ref: string, path: string, out: ValidationError[]): Schema | null {
  if (!ref.startsWith('#/')) {
    out.push({ path, message: `only local $ref is supported, found ${show(ref)}`, unsupported: true });
    return null;
  }
  let node: unknown = root;
  for (const rawPart of ref.slice(2).split('/')) {
    const part = decodeURIComponent(rawPart.replace(/~1/g, '/').replace(/~0/g, '~'));
    if (!isObject(node) || !(part in node)) {
      out.push({ path, message: `$ref ${show(ref)} does not resolve`, unsupported: true });
      return null;
    }
    node = node[part];
  }
  if (!isObject(node)) {
    out.push({ path, message: `$ref ${show(ref)} does not point at a schema`, unsupported: true });
    return null;
  }
  return node;
}

function check(value: unknown, schema: Schema, root: Schema, path: string, out: ValidationError[]): void {
  for (const key of Object.keys(schema)) {
    if (!SUPPORTED.has(key)) {
      out.push({ path, message: `schema keyword ${show(key)} is not supported by this validator`, unsupported: true });
    }
  }

  if (typeof schema['$ref'] === 'string') {
    const target = resolveRef(root, schema['$ref'], path, out);
    if (target !== null) check(value, target, root, path, out);
    return;
  }

  const type = schema['type'];
  if (typeof type === 'string') {
    if (!typeMatches(value, type)) {
      out.push({ path, message: `expected ${type}, found ${typeOf(value)}` });
      return;
    }
  } else if (Array.isArray(type)) {
    if (!type.some((t) => typeof t === 'string' && typeMatches(value, t))) {
      out.push({ path, message: `expected one of ${type.join(' | ')}, found ${typeOf(value)}` });
      return;
    }
  }

  if ('const' in schema && !deepEqual(value, schema['const'])) {
    out.push({ path, message: `must be ${show(schema['const'])}, found ${show(value)}` });
  }

  const enumValues = schema['enum'];
  if (Array.isArray(enumValues) && !enumValues.some((e) => deepEqual(value, e))) {
    out.push({ path, message: `must be one of ${enumValues.map(show).join(', ')}, found ${show(value)}` });
  }

  if (typeof value === 'string') {
    const pattern = schema['pattern'];
    if (typeof pattern === 'string') {
      let re: RegExp;
      try {
        re = new RegExp(pattern, 'u');
      } catch {
        out.push({ path, message: `schema pattern ${show(pattern)} is not a valid regular expression`, unsupported: true });
        re = /(?:)/;
      }
      if (!re.test(value)) out.push({ path, message: `${show(value)} does not match ${show(pattern)}` });
    }
    const minLength = schema['minLength'];
    if (typeof minLength === 'number' && value.length < minLength) {
      out.push({ path, message: `must be at least ${minLength} character(s)` });
    }
    const maxLength = schema['maxLength'];
    if (typeof maxLength === 'number' && value.length > maxLength) {
      out.push({ path, message: `must be at most ${maxLength} character(s)` });
    }
  }

  if (typeof value === 'number') {
    const minimum = schema['minimum'];
    if (typeof minimum === 'number' && value < minimum) out.push({ path, message: `must be >= ${minimum}` });
    const maximum = schema['maximum'];
    if (typeof maximum === 'number' && value > maximum) out.push({ path, message: `must be <= ${maximum}` });
  }

  if (Array.isArray(value)) {
    const items = schema['items'];
    if (isObject(items)) {
      value.forEach((item, i) => check(item, items, root, join(path, i), out));
    }
    const minItems = schema['minItems'];
    if (typeof minItems === 'number' && value.length < minItems) {
      out.push({ path, message: `must have at least ${minItems} item(s), found ${value.length}` });
    }
    const maxItems = schema['maxItems'];
    if (typeof maxItems === 'number' && value.length > maxItems) {
      out.push({ path, message: `must have at most ${maxItems} item(s), found ${value.length}` });
    }
    if (schema['uniqueItems'] === true) {
      for (let i = 0; i < value.length; i++) {
        for (let j = i + 1; j < value.length; j++) {
          if (deepEqual(value[i], value[j])) {
            out.push({ path: join(path, j), message: `duplicate of item ${i} (${show(value[i])})` });
          }
        }
      }
    }
  }

  if (isObject(value)) {
    const required = schema['required'];
    if (Array.isArray(required)) {
      for (const key of required) {
        if (typeof key === 'string' && !(key in value)) {
          out.push({ path, message: `missing required property ${show(key)}` });
        }
      }
    }
    const properties = isObject(schema['properties']) ? schema['properties'] : {};
    for (const [key, sub] of Object.entries(properties)) {
      if (key in value && isObject(sub)) check(value[key], sub, root, join(path, key), out);
    }
    const additional = schema['additionalProperties'];
    if (additional === false) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) out.push({ path: join(path, key), message: `unknown property ${show(key)}` });
      }
    } else if (isObject(additional)) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) check(value[key], additional, root, join(path, key), out);
      }
    }
  }

  const allOf = schema['allOf'];
  if (Array.isArray(allOf)) {
    for (const sub of allOf) if (isObject(sub)) check(value, sub, root, path, out);
  }

  const anyOf = schema['anyOf'];
  if (Array.isArray(anyOf)) {
    const branches = anyOf.filter(isObject);
    const results = branches.map((sub) => {
      const errs: ValidationError[] = [];
      check(value, sub, root, path, errs);
      return errs;
    });
    const unsupported = results.flat().filter((e) => e.unsupported === true);
    if (unsupported.length > 0) out.push(...unsupported);
    else if (results.length > 0 && results.every((errs) => errs.length > 0)) {
      out.push({ path, message: `${show(value)} matches none of the ${branches.length} permitted shapes` });
    }
  }

  const oneOf = schema['oneOf'];
  if (Array.isArray(oneOf)) {
    const branches = oneOf.filter(isObject);
    const results = branches.map((sub) => {
      const errs: ValidationError[] = [];
      check(value, sub, root, path, errs);
      return errs;
    });
    const unsupported = results.flat().filter((e) => e.unsupported === true);
    if (unsupported.length > 0) {
      out.push(...unsupported);
    } else {
      const matched = results.filter((errs) => errs.length === 0).length;
      if (matched === 0) {
        out.push({ path, message: `${show(value)} matches none of the ${branches.length} permitted shapes` });
      } else if (matched > 1) {
        out.push({ path, message: `${show(value)} matches ${matched} shapes where exactly one is permitted` });
      }
    }
  }
}

export function validate(value: unknown, schema: unknown): ValidationError[] {
  if (!isObject(schema)) {
    return [{ path: '', message: 'schema is not a JSON object', unsupported: true }];
  }
  const out: ValidationError[] = [];
  check(value, schema, schema, '', out);
  // A property can collect the same complaint twice through allOf/properties overlap.
  const seen = new Set<string>();
  return out.filter((e) => {
    const key = `${e.path} ${e.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
