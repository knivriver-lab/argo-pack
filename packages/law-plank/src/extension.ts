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
import { HttpMcpCaller, MCP_PATH, type FetchLike, type McpCaller } from './mcp.js';
import { actionTitle, draftProposal, openQuestionsOf, proposeOpenQuestion, type Proposal } from './propose.js';

/** Paths inside the open workspace, read at runtime. Never bundled. */
const UNITS_DIR = 'docs/units';
const UNIT_GLOB = `${UNITS_DIR}/*.md`;
const SCHEMA_PATH = 'docs/schema/unit.schema.json';
const DEPS_PATH = 'docs/deps.toml';

const DIAGNOSTIC_SOURCE = 'law';

/** The authentication provider `mewd.fabric-auth` registers, and the role `propose` needs. */
const PROVIDER_ID = 'mewd';
const CONSTRUCTOR_ROLE = 'role:constructor';
const CONFIG_SECTION = 'mewd.fabric';

/** The command the "propose as OIP" code action runs. */
const PROPOSE_COMMAND = 'law.proposeAsOip';

/** The kind of the propose action. It writes no edit, so it is not a quick fix. */
const PROPOSE_KIND = vscode.CodeActionKind.Empty.append('mewd').append('propose');

const fetchImpl: FetchLike = (input, init) => globalThis.fetch(input, init) as ReturnType<FetchLike>;

/**
 * A caller for the fabric's MCP endpoint, or `null`.
 *
 * `null` is the ordinary state. Without a configured fabric or a session the plank is inert:
 * every other thing it does is local and keeps working, and the one thing that is not local
 * simply does not happen. `createIfNone` is false here because a code action list is built while
 * the operator is reading a document, and a menu that opened a browser would be a menu nobody
 * would open twice.
 */
async function proposeCaller(createIfNone: boolean): Promise<McpCaller | null> {
  const configured = vscode.workspace.getConfiguration(CONFIG_SECTION).get<string>('baseUrl');
  const baseUrl = typeof configured === 'string' ? configured.trim().replace(/\/+$/, '') : '';
  if (baseUrl === '') return null;

  let session: vscode.AuthenticationSession | undefined;
  try {
    session = await vscode.authentication.getSession(PROVIDER_ID, [CONSTRUCTOR_ROLE], { createIfNone });
  } catch {
    // No provider registered, or the operator dismissed the flow.
    return null;
  }
  if (session === undefined) return null;

  return new HttpMcpCaller(`${baseUrl}${MCP_PATH}`, session.accessToken, fetchImpl);
}

/**
 * Run one proposal.
 *
 * Without a session the plank offers a sign-in rather than failing silently, and the operator
 * pressing it is the only thing that starts an authorization flow.
 */
async function runProposal(proposal: Proposal): Promise<void> {
  let caller = await proposeCaller(false);

  if (caller === null) {
    const choice = await vscode.window.showInformationMessage(
      `law: proposing “${proposal.question}” needs a Mew’d fabric session.`,
      'Sign in',
    );
    if (choice !== 'Sign in') return;
    caller = await proposeCaller(true);
    if (caller === null) {
      void vscode.window.showWarningMessage(
        'law: still no session, so nothing was proposed. Check mewd.fabric.baseUrl and that the Mew’d fabric sign-in is installed.',
      );
      return;
    }
  }

  const result = await proposeOpenQuestion(caller, proposal);
  if (result === null) return;

  if (result.ok) {
    void vscode.window.showInformationMessage(
      result.text === '' ? `law: proposed “${proposal.question}”.` : `law: ${result.text}`,
    );
    return;
  }
  void vscode.window.showErrorMessage(`law: the proposal was not accepted (${result.code}) — ${result.message}`);
}

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
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix, PROPOSE_KIND];

  /**
   * One action per open question, hung off the C5 finding that says they are standing.
   *
   * C5 is informational and stays informational — nothing here turns an open question into a
   * problem. The action is an offer beside it, and every band in the pack stays render-only;
   * this is the only place in `argo-pack` where pressing something reaches the fabric.
   */
  #proposeActions(document: vscode.TextDocument, fm: FrontMatter, diagnostic: vscode.Diagnostic): vscode.CodeAction[] {
    const unit = unitIdOf(fm.value);
    if (unit === null) return [];
    const source = vscode.workspace.asRelativePath(document.uri, false);

    return openQuestionsOf(fm).map((question) => {
      const action = new vscode.CodeAction(actionTitle(question), PROPOSE_KIND);
      action.diagnostics = [diagnostic];
      action.command = {
        command: PROPOSE_COMMAND,
        title: actionTitle(question),
        arguments: [draftProposal(unit, source, question)],
      };
      return action;
    });
  }

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
      if (diagnostic.source === DIAGNOSTIC_SOURCE && diagnostic.code === 'C5') {
        actions.push(...this.#proposeActions(document, fm, diagnostic));
      }
    }

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
    vscode.commands.registerCommand(PROPOSE_COMMAND, (proposal: Proposal) => {
      void runProposal(proposal);
    }),
  );

  refreshStatusBar();
  void reviewAllOpen();
}

export function deactivate(): void {
  findingsByDoc.clear();
  lawCache = null;
}
