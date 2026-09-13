/**
 * law-plank — the editor half.
 *
 * Everything that decides anything lives in `law.ts` and `fixes.ts`, which import no editor API
 * at all. This file is the adapter: it reads the open workspace's own files, hands them to the
 * rules, turns findings into diagnostics, and turns a fix descriptor into exactly one
 * `WorkspaceEdit`. It has no other way to change anything, and it never spawns a process.
 *
 * Every file it reads — the unit documents, the tickets, the pathway declarations, the three
 * schemas, the dependency table, the surfaces and the tool manifest — belongs to the workspace.
 * None of them is bundled here, and the plank works out of the box on a workspace that has only
 * some of them, saying so rather than pretending.
 */

import * as vscode from 'vscode';
import { parseDepsToml, type DepsTable } from './deps-toml.js';
import { parseFrontMatter, type FrontMatter } from './front-matter.js';
import { countToFix, type LawFinding } from './finding.js';
import { resolveFix } from './fixes.js';
import { checkUnit, unitIdOf, type WorkspaceLaw } from './law.js';
import {
  checkAssignment,
  checkPathway,
  namesFromYaml,
  readPathway,
  type PathwayDeclaration,
  type PathwayLaw,
} from './pathway.js';
import { checkTicket, readTicket, type TicketLaw } from './ticket.js';
import { HttpMcpCaller, MCP_PATH, type FetchLike, type McpCaller } from './mcp.js';
import { actionTitle, draftProposal, openQuestionsOf, proposeOpenQuestion, type Proposal } from './propose.js';

/** Paths inside the open workspace, read at runtime. Never bundled. */
const UNITS_DIR = 'docs/units';
const UNIT_GLOB = `${UNITS_DIR}/*.md`;
const SCHEMA_PATH = 'docs/schema/unit.schema.json';
const DEPS_PATH = 'docs/deps.toml';

// No glob for the tickets: nothing about one ticket changes the verdict on another, so they are
// read one at a time as they are opened, and there is nothing to watch across them.
const TICKETS_DIR = 'docs/map/tickets';
const TICKET_SCHEMA_PATH = 'docs/schema/ticket.schema.json';

const PATHWAYS_DIR = 'docs/pathways';
const PATHWAY_GLOB = `${PATHWAYS_DIR}/*.toml`;
const PATHWAY_SCHEMA_PATH = 'docs/schema/pathway.schema.json';

/** The two joins a workspace may or may not expose. Absent means unknown, never a pass. */
const SURFACES_PATH = 'docs/surfaces.yml';
const TOOLS_PATH = 'docs/tools.yml';

const ASSIGNMENT_PATH = 'assignment.toml';

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

/** Everything the four rule files need, built once per workspace and thrown away on any change. */
interface WorkspaceContext {
  readonly unit: WorkspaceLaw;
  readonly ticket: TicketLaw;
  readonly pathway: PathwayLaw;
  readonly pathways: ReadonlyMap<string, PathwayDeclaration> | null;
}

/** Cache only. Everything in here can be thrown away and rebuilt from the workspace. */
const findingsByDoc = new Map<string, LawFinding[]>();
let contextCache: WorkspaceContext | null = null;

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

type DocumentKind = 'unit' | 'ticket' | 'pathway' | 'assignment' | null;

function kindOf(document: vscode.TextDocument): DocumentKind {
  if (rootOf(document) === undefined) return null;
  const rel = vscode.workspace.asRelativePath(document.uri, false);
  if (rel.startsWith(`${UNITS_DIR}/`) && rel.endsWith('.md')) return 'unit';
  if (rel.startsWith(`${TICKETS_DIR}/`) && rel.endsWith('.md')) return 'ticket';
  if (rel.startsWith(`${PATHWAYS_DIR}/`) && rel.endsWith('.toml')) return 'pathway';
  if (rel === ASSIGNMENT_PATH) return 'assignment';
  return null;
}

function uriOf(folder: vscode.WorkspaceFolder, path: string): vscode.Uri {
  return vscode.Uri.joinPath(folder.uri, ...path.split('/'));
}

/**
 * A schema out of the open workspace.
 *
 * A file that is present but unreadable is not the same as one that is absent, and the operator
 * is told which it is. Either way the answer is `null`, and every rule that depends on it
 * reports unknown rather than clean.
 */
async function readSchema(folder: vscode.WorkspaceFolder, path: string): Promise<unknown> {
  const text = await readTextIfPresent(uriOf(folder, path));
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch (err) {
    void vscode.window.showWarningMessage(
      `law: ${path} is not valid JSON (${err instanceof Error ? err.message : String(err)}), so nothing is being validated against it.`,
    );
    return null;
  }
}

async function readNames(
  folder: vscode.WorkspaceFolder,
  path: string,
  key: string,
): Promise<ReadonlySet<string> | null> {
  const text = await readTextIfPresent(uriOf(folder, path));
  return text === null ? null : namesFromYaml(text, key);
}

/**
 * Every pathway the workspace declares, keyed by the id it declares.
 *
 * `null` means there is no `docs/pathways/` at all, which C7 and the assignment check report as
 * unknown. An empty map means the directory is there and declares nothing usable, which is a
 * different thing and reads differently in the message.
 */
async function loadPathways(
  folder: vscode.WorkspaceFolder,
): Promise<ReadonlyMap<string, PathwayDeclaration> | null> {
  const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, PATHWAY_GLOB), undefined, 2000);
  if (uris.length === 0) return null;

  const byId = new Map<string, PathwayDeclaration>();
  for (const uri of uris) {
    const text = await readTextIfPresent(uri);
    if (text === null) continue;
    const rel = vscode.workspace.asRelativePath(uri, false);
    const declaration = readPathway(rel, text);
    // A declaration that names no id is still addressable by its file name, which is what a
    // reader would reach for anyway.
    const id = declaration.id ?? rel.slice(rel.lastIndexOf('/') + 1).replace(/\.toml$/, '');
    if (!byId.has(id)) byId.set(id, declaration);
  }
  return byId;
}

/** Build the picture of the workspace the rules need, from the workspace's own files. */
async function loadContext(folder: vscode.WorkspaceFolder): Promise<WorkspaceContext> {
  const unitSchema = await readSchema(folder, SCHEMA_PATH);

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

  const depsText = await readTextIfPresent(uriOf(folder, DEPS_PATH));
  const deps: DepsTable | null = depsText === null ? null : parseDepsToml(depsText);
  const pathways = await loadPathways(folder);

  return {
    unit: {
      unitSchema,
      unitSchemaPath: SCHEMA_PATH,
      unitIds,
      deps,
      depsPath: DEPS_PATH,
      pathways,
      pathwaysDir: PATHWAYS_DIR,
    },
    ticket: {
      ticketSchema: await readSchema(folder, TICKET_SCHEMA_PATH),
      ticketSchemaPath: TICKET_SCHEMA_PATH,
    },
    pathway: {
      pathwaySchema: await readSchema(folder, PATHWAY_SCHEMA_PATH),
      pathwaySchemaPath: PATHWAY_SCHEMA_PATH,
      surfaces: await readNames(folder, SURFACES_PATH, 'surfaces'),
      surfacesPath: SURFACES_PATH,
      tools: await readNames(folder, TOOLS_PATH, 'tools'),
      toolsPath: TOOLS_PATH,
    },
    pathways,
  };
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
      ? 'law-plank: every open document satisfies the law'
      : `law-plank: ${total} thing(s) to fix across the open documents`;
  statusBar.show();
}

/**
 * Which rules a document is held to.
 *
 * A pathway declaration is read from the text on screen rather than from the cached map, so that
 * what the editor shows is what the author is looking at and not what was last saved.
 */
function findingsFor(
  kind: Exclude<DocumentKind, null>,
  document: vscode.TextDocument,
  context: WorkspaceContext,
): LawFinding[] {
  const text = document.getText();
  switch (kind) {
    case 'unit':
      return checkUnit(parseFrontMatter(text), context.unit);
    case 'ticket':
      return checkTicket(readTicket(text), context.ticket);
    case 'pathway':
      return checkPathway(
        readPathway(vscode.workspace.asRelativePath(document.uri, false), text),
        context.pathway,
      );
    case 'assignment':
      return checkAssignment(text, context.pathways, PATHWAYS_DIR);
  }
}

async function review(document: vscode.TextDocument): Promise<void> {
  const kind = kindOf(document);
  if (kind === null) {
    if (findingsByDoc.delete(document.uri.toString())) {
      diagnostics.delete(document.uri);
      refreshStatusBar();
    }
    return;
  }

  const folder = rootOf(document);
  if (folder === undefined) return;

  contextCache ??= await loadContext(folder);
  const findings = findingsFor(kind, document, contextCache);

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
  contextCache = null;
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

      if (resolved.target === 'document') {
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

  // Every one of these comes from the workspace, so a change to any of them can change the
  // verdict on a document that was not itself touched. A new pathway declaration, in particular,
  // can turn C7's "undeclared pathway" into a clean unit without the unit changing at all.
  for (const pattern of [
    SCHEMA_PATH,
    TICKET_SCHEMA_PATH,
    PATHWAY_SCHEMA_PATH,
    DEPS_PATH,
    SURFACES_PATH,
    TOOLS_PATH,
    UNIT_GLOB,
    PATHWAY_GLOB,
  ]) {
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
  contextCache = null;
}
