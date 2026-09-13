/**
 * berth-sessions — the editor half.
 *
 * A read-only mirror of the supervisor's berths in the editor's own Agent Sessions view, so the
 * operator sees them where they already look instead of where this pack decided to put them.
 *
 * The shape:
 *
 *     Agent Sessions view  ──(refresh)──▶  extension host  ──▶  authentication provider (mewd)
 *            ▲                                   │
 *            └────────(items: label, state)──────┘ ──▶  GET <baseUrl>/dashboard/sessions
 *
 * Three things about that diagram are the plank:
 *
 * 1. **The arrow out of the view is a refresh and nothing else.** There is no command here that
 *    ends, starts or alters a session. The editor's session surface offers those affordances to
 *    providers and this one declines them; `pack-lint` fails the manifest if that ever stops
 *    being true, so it is a checked claim rather than a stated one.
 * 2. **The bearer is obtained here and stays here.** It goes onto one GET and is not written
 *    into any item. Items are handed to the editor, which keeps them, and a token in one would
 *    be a token everywhere the editor takes them.
 * 3. **The origin stays here too.** Items are addressed by session id under a scheme of this
 *    plank's own, never by the URL they came from, so the operator's fabric address is not put
 *    into a `Uri` the editor stores and renders.
 *
 * The whole of it is behind a guard: this is a proposed API, and on a build that does not expose
 * it the plank registers no provider and performs no read.
 */

import * as vscode from 'vscode';
import { hasSessionProviderApi, INERT_REASON, SESSION_API_PROPOSAL } from './guard.js';
import { itemFieldsFor, BERTH_SCHEME, type ItemFields } from './items.js';
import { emptyReason, readMirror, type Mirror } from './mirror.js';
import { BERTHS_FOCUS_COMMAND, REVEAL_COMMAND, revealInBerths } from './reveal.js';
import type { FetchLike } from './client.js';

/** The session type this plank contributes, matching `contributes.chatSessions` in package.json. */
const SESSION_TYPE = 'mewd-berths';

/** The provider `fabric-auth` registers, and the role the berths are a view of. */
const PROVIDER_ID = 'mewd';
const CONSTRUCTOR_ROLE = 'role:constructor';

const CONFIG_SECTION = 'mewd.fabric';
const BASE_URL_KEY = 'baseUrl';

/** Set while the mirror is live, so the palette does not offer a command that would do nothing. */
const MIRRORING_CONTEXT = 'mewdBerths.mirroring';

const fetchImpl: FetchLike = (input, init) => globalThis.fetch(input, init) as ReturnType<FetchLike>;

function baseUrl(): string | null {
  const value = vscode.workspace.getConfiguration(CONFIG_SECTION).get<string>(BASE_URL_KEY);
  const trimmed = typeof value === 'string' ? value.trim().replace(/\/+$/, '') : '';
  return trimmed === '' ? null : trimmed;
}

/**
 * The bearer, or nothing.
 *
 * `createIfNone` is false and there is no path in this plank that sets it true. The session view
 * refreshes on the editor's schedule — on load, on focus, whenever it feels like it — and a
 * refresh that could open a browser tab would make an authorization prompt a thing that happens
 * to the operator rather than a thing they asked for. Signing in is `fabric-auth`'s affordance.
 */
async function currentBearer(): Promise<string | null> {
  try {
    const session = await vscode.authentication.getSession(PROVIDER_ID, [CONSTRUCTOR_ROLE], { createIfNone: false });
    return session?.accessToken ?? null;
  } catch {
    // No provider registered (fabric-auth not installed), or the editor declined. Either way
    // there is no bearer, and a mirror with no bearer shows nothing rather than guessing.
    return null;
  }
}

/** `ItemStatus` as the editor's enum. Kept here because the enum is an editor object. */
function statusOf(fields: ItemFields): vscode.ChatSessionStatus | undefined {
  switch (fields.status) {
    case 'in-progress':
      return vscode.ChatSessionStatus.InProgress;
    case 'needs-input':
      return vscode.ChatSessionStatus.NeedsInput;
    case 'completed':
      return vscode.ChatSessionStatus.Completed;
    case 'failed':
      return vscode.ChatSessionStatus.Failed;
    case 'none':
      // No status at all, rather than a status meaning "fine". The editor renders the absence.
      return undefined;
  }
}

function resourceFor(fields: ItemFields): vscode.Uri {
  // `from` rather than `parse`, so the path is carried as data and cannot be re-read as an
  // authority. There is no `authority` here and there is nowhere for an origin to appear.
  return vscode.Uri.from({ scheme: BERTH_SCHEME, path: fields.path });
}

/**
 * Fill a session item from a berth.
 *
 * Every property written below is a label, a note or a timestamp. That list is the read-only
 * claim in its most literal form: there is no handler assigned to the item, so there is nothing
 * the editor can invoke on it that reaches this plank, and nothing this plank could reach the
 * fabric with if it did.
 */
function fillItem(item: vscode.ChatSessionItem, fields: ItemFields): vscode.ChatSessionItem {
  item.label = fields.label;
  if (fields.description !== null) item.description = fields.description;
  item.tooltip = fields.tooltip;
  const status = statusOf(fields);
  if (status !== undefined) item.status = status;
  if (fields.created !== null) {
    item.timing =
      fields.lastRequestEnded === null
        ? { created: fields.created }
        : { created: fields.created, lastRequestEnded: fields.lastRequestEnded };
  }
  return item;
}

export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel('Mew’d berths', { log: true });
  context.subscriptions.push(log);

  // The deep link is registered whatever build this is. It focuses a view and touches no fabric,
  // so there is no reason to withhold it — and a contributed command with no registration behind
  // it is an error message waiting for whoever opens the palette.
  context.subscriptions.push(
    vscode.commands.registerCommand(REVEAL_COMMAND, async () => {
      await revealInBerths((command, ...args) => vscode.commands.executeCommand(command, ...args));
    }),
  );

  if (!hasSessionProviderApi(vscode.chat)) {
    void vscode.commands.executeCommand('setContext', MIRRORING_CONTEXT, false);
    log.info(INERT_REASON);
    return;
  }

  const controller = vscode.chat.createChatSessionItemController(SESSION_TYPE, async () => {
    const mirror: Mirror = await readMirror({ baseUrl, bearer: currentBearer, fetchImpl });

    if (mirror.kind !== 'berths') {
      // Nothing readable. The collection is emptied rather than left showing the last good
      // answer: a stale berth list is indistinguishable from a current one, and the operator
      // would be reading a claim about the fabric that nothing supports any more.
      controller.items.replace([]);
    } else {
      controller.items.replace(
        mirror.berths.map((berth) => {
          const fields = itemFieldsFor(berth);
          return fillItem(controller.createChatSessionItem(resourceFor(fields), fields.label), fields);
        }),
      );
    }

    // An empty session list is rendered the same way whether the fabric is quiet or unreachable,
    // and those are not the same news. Whenever there is nothing to show, say why in words.
    const empty = emptyReason(mirror);
    if (empty !== null) log.info(empty);
    else if (mirror.kind === 'berths') log.info(`mirrored ${mirror.berths.length} berth(s) at ${mirror.at}`);
  });

  context.subscriptions.push(controller);
  void vscode.commands.executeCommand('setContext', MIRRORING_CONTEXT, true);
  log.info(
    `mirroring Mew’d berths into the native session view via the ${SESSION_API_PROPOSAL} proposed API; ` +
      `"${REVEAL_COMMAND}" focuses ${BERTHS_FOCUS_COMMAND} and is the only command this plank contributes`,
  );

  const refresh = (): void => {
    void controller.refreshHandler(new vscode.CancellationTokenSource().token);
  };

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(`${CONFIG_SECTION}.${BASE_URL_KEY}`)) refresh();
    }),
    vscode.authentication.onDidChangeSessions((event) => {
      if (event.provider.id === PROVIDER_ID) refresh();
    }),
  );
}

export function deactivate(): void {
  // The controller is in `context.subscriptions` and the items are the editor's. There is no
  // durable state here to unwind — this plank has never written any.
}
