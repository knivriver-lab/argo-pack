/**
 * law-plank — the editor half.
 *
 * Everything that decides anything lives in `law.ts` and `fixes.ts`, which import no editor API
 * at all. This file is the adapter: it reads the open workspace's own files, hands them to the
 * rules, turns findings into diagnostics, and turns a fix descriptor into exactly one
 * `WorkspaceEdit`. It has no other way to change anything, and it never spawns a process.
 *
 * The three files it reads — the unit documents, the schema, the dependency table — belong to
 * the workspace. None of them is bundled here, and the plank works out of the box on a
 * workspace that has only some of them, saying so rather than pretending.
 */

import * as vscode from 'vscode';
import { parseDepsToml, type DepsTable } from './deps-toml.js';
import { parseFrontMatter, type FrontMatter } from './front-matter.js';
import { resolveFix } from './fixes.js';
import { checkUnit, countToFix, unitIdOf, type LawFinding, type WorkspaceLaw } from './law.js';

/** Paths inside the open workspace, read at runtime. Never bundled. */
const UNITS_DIR = 'docs/units';
const UNIT_GLOB = `${UNITS_DIR}/*.md`;
const SCHEMA_PATH = 'docs/schema/unit.schema.json';
const DEPS_PATH = 'docs/deps.toml';

const DIAGNOSTIC_SOURCE = 'law';

const SEVERITY: Record<LawFinding['severity'], vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  information: vscode.DiagnosticSeverity.Information,
};

let diagnostics: vscode.DiagnosticCollection;
let statusBar: vscode.StatusBarItem;

/** Cache only. Everything in here can be thrown away and rebuilt from the workspace. */
const findingsByDoc = new Map<string, LawFinding[]>();
let lawCache: WorkspaceLaw | null = null;

async function readTextIfPresent(uri: vscode.Uri): Promise<string | null> {
  try {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    return null;
  }
}

function rootOf(document: vscode.TextDocument): vscode.WorkspaceFolder | undefined {
  return vscode.workspace.getWorkspaceFolder(document.uri);
}

function isUnitDocument(document: vscode.TextDocument): boolean {
  const folder = rootOf(document);
  if (folder === undefined) return false;
  const rel = vscode.workspace.asRelativePath(document.uri, false);
  return rel.startsWith(`${UNITS_DIR}/`) && rel.endsWith('.md');
}

/** Build the picture of the workspace the rules need, from the workspace's own files. */
async function loadLaw(folder: vscode.WorkspaceFolder): Promise<WorkspaceLaw> {
  const schemaText = await readTextIfPresent(vscode.Uri.joinPath(folder.uri, ...SCHEMA_PATH.split('/')));
  let unitSchema: unknown = null;
  if (schemaText !== null) {
    try {
      unitSchema = JSON.parse(schemaText) as unknown;
    } catch (err) {
      void vscode.window.showWarningMessage(
        `law: ${SCHEMA_PATH} is not valid JSON (${err instanceof Error ? err.message : String(err)}), so front matter is not being validated.`,
      );
      unitSchema = null;
    }
  }

  const unitIds = new Set<string>();
  for (const uri of await vscode.workspace.findFiles(
    new vscode.RelativePattern(folder, UNIT_GLOB),
    undefined,
    2000,
  )) {
    const text = await readTextIfPresent(uri);
    if (text === null) continue;
    const id = unitIdOf(parseFrontMatter(text).value);
    if (id !== null) unitIds.add(id);
  }

  const depsText = await readTextIfPresent(vscode.Uri.joinPath(folder.uri, ...DEPS_PATH.split('/')));
  const deps: DepsTable | null = depsText === null ? null : parseDepsToml(depsText);

  return { unitSchema, unitSchemaPath: SCHEMA_PATH, unitIds, deps, depsPath: DEPS_PATH };
}

function toDiagnostic(document: vscode.TextDocument, finding: LawFinding): vscode.Diagnostic {
  const lineLength = finding.line < document.lineCount ? document.lineAt(finding.line).text.length : 0;
  const start = new vscode.Position(finding.line, Math.min(finding.column, lineLength));
  const end = new vscode.Position(finding.line, Math.min(Math.max(finding.endColumn, finding.column + 1), lineLength));
  const diagnostic = new vscode.Diagnostic(new vscode.Range(start, end), finding.message, SEVERITY[finding.severity]);
  diagnostic.source = DIAGNOSTIC_SOURCE;
  diagnostic.code = finding.code;
  return diagnostic;
}

function refreshStatusBar(): void {
  let total = 0;
  for (const findings of findingsByDoc.values()) total += countToFix(findings);
  statusBar.text = `law: ${total} to fix`;
  statusBar.tooltip =
    total === 0
      ? 'law-plank: every open unit document satisfies the law'
      : `law-plank: ${total} thing(s) to fix across the open unit documents`;
  statusBar.show();
}

async function review(document: vscode.TextDocument): Promise<void> {
  if (!isUnitDocument(document)) {
    if (findingsByDoc.delete(document.uri.toString())) {
      diagnostics.delete(document.uri);
      refreshStatusBar();
    }
    return;
  }

  const folder = rootOf(document);
  if (folder === undefined) return;

  lawCache ??= await loadLaw(folder);
  const findings = checkUnit(parseFrontMatter(document.getText()), lawCache);

  findingsByDoc.set(document.uri.toString(), findings);
  diagnostics.set(
    document.uri,
    findings.map((f) => toDiagnostic(document, f)),
  );
  refreshStatusBar();
}

async function reviewAllOpen(): Promise<void> {
  for (const document of vscode.workspace.textDocuments) await review(document);
}

function invalidate(): void {
  lawCache = null;
  void reviewAllOpen();
}

/**
 * The code action provider.
 *
 * A fix is looked up by the diagnostic it hangs off, resolved to a plain edit, and applied as a
 * single `WorkspaceEdit`. Nothing else happens.
 */
class LawCodeActions implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  async provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
  ): Promise<vscode.CodeAction[]> {
    const findings = findingsByDoc.get(document.uri.toString());
    if (findings === undefined) return [];

    const folder = rootOf(document);
    if (folder === undefined) return [];

    const depsUri = vscode.Uri.joinPath(folder.uri, ...DEPS_PATH.split('/'));
    const fm = parseFrontMatter(document.getText());
    let depsText: string | null | undefined;
    const actions: vscode.CodeAction[] = [];

    for (const diagnostic of context.diagnostics) {
      if (diagnostic.source !== DIAGNOSTIC_SOURCE) continue;
      const finding = findings.find(
        (f) => f.code === diagnostic.code && f.line === diagnostic.range.start.line && f.message === diagnostic.message,
      );
      if (finding?.fix === undefined) continue;

      if (finding.fix.kind === 'add-deps-entry' && depsText === undefined) {
        depsText = await readTextIfPresent(depsUri);
      }

      const resolved = resolveFix(finding.fix, document.getText(), fm, depsText ?? null);
      if (resolved === null) continue;

      const action = new vscode.CodeAction(finding.fix.title, vscode.CodeActionKind.QuickFix);
      action.diagnostics = [diagnostic];
      const edit = new vscode.WorkspaceEdit();

      if (resolved.target === 'unit') {
        const { startLine, startColumn, endLine, endColumn, newText } = resolved.edit;
        edit.replace(
          document.uri,
          new vscode.Range(new vscode.Position(startLine, startColumn), new vscode.Position(endLine, endColumn)),
          newText,
        );
      } else {
        if (resolved.createdFile) edit.createFile(depsUri, { ignoreIfExists: true });
        edit.replace(depsUri, new vscode.Range(0, 0, Number.MAX_SAFE_INTEGER, 0), resolved.contents);
      }

      action.edit = edit;
      actions.push(action);
    }

    return actions;
  }
}

export function activate(context: vscode.ExtensionContext): void {
  diagnostics = vscode.languages.createDiagnosticCollection(DIAGNOSTIC_SOURCE);
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = 'workbench.actions.view.problems';
  context.subscriptions.push(diagnostics, statusBar);

  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      { language: 'markdown', scheme: 'file' },
      new LawCodeActions(),
      { providedCodeActionKinds: LawCodeActions.providedCodeActionKinds },
    ),
  );

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((d) => void review(d)),
    vscode.workspace.onDidChangeTextDocument((e) => void review(e.document)),
    vscode.workspace.onDidCloseTextDocument((d) => {
      findingsByDoc.delete(d.uri.toString());
      diagnostics.delete(d.uri);
      refreshStatusBar();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(invalidate),
  );

  // The schema, the dependency table and the set of unit ids all come from the workspace, so a
  // change to any of them can change the verdict on a document that was not itself touched.
  for (const pattern of [SCHEMA_PATH, DEPS_PATH, UNIT_GLOB]) {
    const watcher = vscode.workspace.createFileSystemWatcher(`**/${pattern}`);
    watcher.onDidCreate(invalidate);
    watcher.onDidChange(invalidate);
    watcher.onDidDelete(invalidate);
    context.subscriptions.push(watcher);
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('law.recheck', () => {
      invalidate();
    }),
  );

  refreshStatusBar();
  void reviewAllOpen();
}

export function deactivate(): void {
  findingsByDoc.clear();
  lawCache = null;
}
