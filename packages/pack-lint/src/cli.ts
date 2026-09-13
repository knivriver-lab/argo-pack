#!/usr/bin/env node
/**
 * pack-lint [--only=manifests|private-refs|bundle|webviews] [root]
 *
 * Exits non-zero on the first finding. There are no warnings: every rule here is something the
 * pack has promised not to do.
 */

import { lintTree, type LintOptions } from './lint.js';

const USAGE = `pack-lint [--only=manifests|private-refs|bundle|webviews] [root]

  manifests      every packages/*/plank.yaml against schemas/plank.schema.json,
                 plus keel, upstream, terminal and dead-grant checks
  private-refs   the whole tree, for host names, addresses and home paths
  bundle         the compiled payload and any built .vsix, for copied workspace files
  webviews       every packages/*/media asset, for a credential, a host literal,
                 a request of its own, a navigation, or a missing content policy

With no --only, all four run.`;

const CHECKS = ['manifests', 'private-refs', 'bundle', 'webviews'] as const;

function main(argv: readonly string[]): number {
  const args = [...argv];
  const options: LintOptions = {};
  let root = '.';

  for (const arg of args) {
    if (arg === '-h' || arg === '--help') {
      process.stdout.write(`${USAGE}\n`);
      return 0;
    }
    if (arg.startsWith('--only=')) {
      const value = arg.slice('--only='.length);
      if (!(CHECKS as readonly string[]).includes(value)) {
        process.stderr.write(`pack-lint: unknown check ${JSON.stringify(value)}\n\n${USAGE}\n`);
        return 2;
      }
      (options as { only?: LintOptions['only'] }).only = value as LintOptions['only'];
      continue;
    }
    if (arg.startsWith('-')) {
      process.stderr.write(`pack-lint: unknown option ${arg}\n\n${USAGE}\n`);
      return 2;
    }
    root = arg;
  }

  let report;
  try {
    report = lintTree(root, options);
  } catch (err) {
    process.stderr.write(`pack-lint: ${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }

  for (const f of report.findings) {
    process.stdout.write(`${f.file}:${f.line}:${f.column}  ${f.rule}  ${f.message}\n`);
  }

  const scope = options.only ?? 'all';
  if (report.findings.length > 0) {
    process.stdout.write(`\npack-lint (${scope}): ${report.findings.length} finding(s)\n`);
    return 1;
  }
  process.stdout.write(
    `pack-lint (${scope}): clean — ${report.plankCount} plank(s), ${report.filesScanned} file(s) scanned, ${report.bundlesScanned} bundled file(s) checked, ${report.webviewAssetsScanned} webview asset(s) checked\n`,
  );
  return 0;
}

process.exitCode = main(process.argv.slice(2));
