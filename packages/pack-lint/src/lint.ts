/** Walking a tree, gathering planks, and running the three checks over what is found. */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { loadPlankSchema, parseYamlLite, YamlLiteError } from '@argo/schemas';
import { lintManifest, type Finding, type PlankSource } from './rules.js';
import { RULE_DEFINITION_FILES, extraDenyTerms, scanPrivateRefs } from './private-refs.js';
import {
  denylistTokens,
  listVsixEntries,
  packagedWorkspaceArtefacts,
  scanBundleText,
} from './bundle-guard.js';
import {
  checkContentSecurityPolicy,
  isWebviewAsset,
  scanWebviewAsset,
  WEBVIEW_RULE_DEFINITION_FILES,
} from './webview-guard.js';

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'out', 'coverage', '.vscode-test']);

const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.md',
  '.html',
  '.css',
  '.svg',
  '.sh',
  '.txt',
]);

/** Files that cannot carry a private reference by construction, or that define the rules. */
const PRIVATE_REF_EXEMPT = new Set<string>([
  ...RULE_DEFINITION_FILES,
  ...WEBVIEW_RULE_DEFINITION_FILES,
  'LICENSE',
  'package-lock.json',
]);

export function walk(root: string, dir = root, out: string[] = []): string[] {
  for (const name of readdirSync(dir).sort()) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(root, full, out);
    else if (st.isFile()) out.push(relative(root, full).split(sep).join('/'));
  }
  return out;
}

/**
 * The subset of `.gitignore` this needs: bare names, directory names, and `*.ext` globs.
 *
 * The lint is about what the repository carries, so anything git is told to ignore is out of
 * scope — a contributor's scratch file is not part of the pack. Anything more elaborate than
 * these three shapes is not matched, which errs towards scanning a file rather than skipping it.
 */
export function gitignoreMatcher(root: string): (path: string) => boolean {
  const file = join(root, '.gitignore');
  if (!existsSync(file)) return () => false;

  const patterns = readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#') && !l.startsWith('!'))
    .map((l) => l.replace(/\/$/, ''));

  const literals = new Set(patterns.filter((p) => !p.includes('*')));
  const extensions = patterns.filter((p) => /^\*\.[A-Za-z0-9.]+$/.test(p)).map((p) => p.slice(1));

  return (path: string): boolean => {
    if (extensions.some((ext) => path.endsWith(ext))) return true;
    const segments = path.split('/');
    return segments.some((segment, i) => literals.has(segment) || literals.has(segments.slice(0, i + 1).join('/')));
  };
}

function hasTextExtension(path: string): boolean {
  const dot = path.lastIndexOf('.');
  if (dot === -1) return path === 'LICENSE' || path.startsWith('.git');
  return TEXT_EXTENSIONS.has(path.slice(dot));
}

export interface LintOptions {
  /** Restrict the run to one check. Omitted means all four. */
  readonly only?: 'manifests' | 'private-refs' | 'bundle' | 'webviews';
}

export interface LintReport {
  readonly findings: Finding[];
  readonly plankCount: number;
  readonly filesScanned: number;
  readonly bundlesScanned: number;
  readonly webviewAssetsScanned: number;
}

/** Every plank manifest under `packages`, with the plank's own source concatenated for the grant checks. */
export function collectPlanks(root: string): PlankSource[] {
  const packagesDir = join(root, 'packages');
  if (!existsSync(packagesDir)) return [];
  const planks: PlankSource[] = [];
  for (const name of readdirSync(packagesDir).sort()) {
    const manifestFile = join(packagesDir, name, 'plank.yaml');
    if (!existsSync(manifestFile)) continue;
    const manifestPath = `packages/${name}/plank.yaml`;
    const text = readFileSync(manifestFile, 'utf8');

    const srcDir = join(packagesDir, name, 'src');
    const sourceText = existsSync(srcDir)
      ? walk(srcDir)
          .filter((f) => f.endsWith('.ts'))
          .map((f) => readFileSync(join(srcDir, f), 'utf8'))
          .join('\n')
      : '';

    // The plank's own package.json, for the commands it contributes to the editor. A manifest
    // that cannot be read leaves this undefined rather than empty: no commands and unreadable
    // commands are different findings, and only one of them is a clean plank.
    let packageJson: unknown;
    const packageFile = join(packagesDir, name, 'package.json');
    if (existsSync(packageFile)) {
      try {
        packageJson = JSON.parse(readFileSync(packageFile, 'utf8')) as unknown;
      } catch {
        packageJson = undefined;
      }
    }

    try {
      const { value, positions } = parseYamlLite(text);
      planks.push({ manifestPath, manifest: value, positions, sourceText, packageJson });
    } catch (err) {
      const line = err instanceof YamlLiteError ? err.line + 1 : 1;
      planks.push({
        manifestPath,
        manifest: { __parseError: err instanceof Error ? err.message : String(err), __line: line },
        positions: new Map(),
        sourceText,
        packageJson,
      });
    }
  }
  return planks;
}

export function lintTree(root: string, options: LintOptions = {}): LintReport {
  const findings: Finding[] = [];
  const only = options.only;
  let plankCount = 0;
  let filesScanned = 0;
  let bundlesScanned = 0;
  let webviewAssetsScanned = 0;

  if (only === undefined || only === 'manifests') {
    const schema = loadPlankSchema();
    const planks = collectPlanks(root);
    plankCount = planks.length;
    if (planks.length === 0) {
      findings.push({
        file: 'packages',
        line: 1,
        column: 1,
        rule: 'pack/empty',
        message: 'no packages/*/plank.yaml found — every package in the pack ships a manifest',
        severity: 'error',
      });
    }
    for (const plank of planks) findings.push(...lintManifest(plank, schema));
  }

  if (only === undefined || only === 'private-refs') {
    const extra = extraDenyTerms();
    const ignored = gitignoreMatcher(root);
    for (const file of walk(root)) {
      if (PRIVATE_REF_EXEMPT.has(file) || !hasTextExtension(file) || ignored(file)) continue;
      filesScanned++;
      const text = readFileSync(join(root, file), 'utf8');
      for (const hit of scanPrivateRefs(text, extra)) {
        findings.push({
          file,
          line: hit.line,
          column: hit.column,
          rule: `private-ref/${hit.ruleId}`,
          message: `${hit.description}: ${hit.match} — argo-pack is public and names no host, address or home directory`,
          severity: 'error',
        });
      }
    }
  }

  if (only === undefined || only === 'bundle') {
    const tokens = denylistTokens();

    // The compiled payload: exactly the files that go into a .vsix.
    const packagesDir = join(root, 'packages');
    if (existsSync(packagesDir)) {
      for (const name of readdirSync(packagesDir).sort()) {
        for (const sub of ['dist', 'media']) {
          const dir = join(packagesDir, name, sub);
          if (!existsSync(dir)) continue;
          for (const file of walk(dir)) {
            if (file.endsWith('.map')) continue;
            if (!hasTextExtension(file)) continue;
            bundlesScanned++;
            const rel = `packages/${name}/${sub}/${file}`;
            for (const hit of scanBundleText(readFileSync(join(dir, file), 'utf8'), tokens)) {
              findings.push({
                file: rel,
                line: hit.line,
                column: hit.column,
                rule: 'bundle/denylist',
                message: `bundled payload carries a denylisted token (${hit.token.length} chars) — a plank reads the open workspace, it never carries a copy of one … ${hit.context}`,
                severity: 'error',
              });
            }
          }
        }
      }
    }

    // The packaged .vsix files: no workspace schema or unit document may be inside one.
    const distDir = join(root, 'dist');
    if (existsSync(distDir)) {
      for (const file of readdirSync(distDir).sort()) {
        if (!file.endsWith('.vsix')) continue;
        const packaged = packagedWorkspaceArtefacts(listVsixEntries(join(distDir, file)));
        for (const entry of packaged) {
          findings.push({
            file: `dist/${file}`,
            line: 1,
            column: 1,
            rule: 'bundle/packaged-workspace-file',
            message: `packages ${entry} — schemas and unit documents belong to the open workspace and are read at runtime, never bundled`,
            severity: 'error',
          });
        }
      }
    }
  }

  if (only === undefined || only === 'webviews') {
    const ignored = gitignoreMatcher(root);
    for (const file of walk(root)) {
      if (!isWebviewAsset(file) || ignored(file)) continue;
      webviewAssetsScanned++;
      const text = readFileSync(join(root, file), 'utf8');

      for (const hit of scanWebviewAsset(text)) {
        findings.push({
          file,
          line: hit.line,
          column: hit.column,
          rule: `webview/${hit.ruleId}`,
          message: `${hit.description}: ${hit.match} — ${hit.because}`,
          severity: 'error',
        });
      }

      if (file.toLowerCase().endsWith('.html') || file.toLowerCase().endsWith('.htm')) {
        for (const problem of checkContentSecurityPolicy(text)) {
          findings.push({
            file,
            line: problem.line,
            column: 1,
            rule: 'webview/csp',
            message: problem.message,
            severity: 'error',
          });
        }
      }
    }
  }

  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column);
  return { findings, plankCount, filesScanned, bundlesScanned, webviewAssetsScanned };
}
