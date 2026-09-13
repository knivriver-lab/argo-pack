/**
 * The session-mirror rules.
 *
 * A plank that mirrors the fabric's sessions into the editor's native session view is in a
 * different position from every other plank in this pack, and the difference is the surface
 * rather than the code. A webview this pack drew is a page nobody has prior expectations about.
 * The editor's session list is not: every other provider that appears in it offers a menu that
 * stops a session, restarts one or throws one away, and an operator who has used any of them
 * will arrive at a mirrored berth expecting the same. If that expectation is ever met, the
 * fabric has a second front door, opened from a view whose whole claim was that it only looks.
 *
 * "Only looks" is therefore not a thing to write in a README. These rules check it:
 *
 *   - `plank/session-mirror-effect-command` — a command, contributed or registered, whose name
 *     says it does something to a session.
 *   - `plank/session-mirror-write-method`   — a request built with a method that is not a read.
 *
 * **What makes a plank a session mirror.** Its manifest declares `upstream: session-provider`
 * *and* its source registers session items with the editor. Both halves are needed. The
 * authentication provider in `fabric-auth` declares the same upstream point — it provides a
 * session in the other sense of the word — and it legitimately offers a sign-out, which revokes
 * a refresh lineage on the fabric. That is an effect, it is declared as one, and it is not a
 * session list. These rules are about the list.
 *
 * **Why the verbs are a list.** Naming is the only thing available here: the lint reads a
 * manifest, a `package.json` and a wall of source, and cannot tell what a command does. A list
 * of words catches the honest case, which is the case that actually occurs — someone adds
 * "Stop session" to the mirror because the surface invited it. It does not catch a command
 * called `mewdBerths.doTheThing`, and nothing a linter can do would. The second rule is the one
 * with teeth: a mirror that only reads makes requests of one kind, and a request built any other
 * way is a fact about the code rather than a fact about its naming.
 */

export interface SessionMirrorHit {
  readonly ruleId: 'session-mirror-effect-command' | 'session-mirror-write-method';
  readonly message: string;
}

/**
 * The markers that mean a plank puts session items in front of the operator.
 *
 * Both the controller and the older provider registration from the `chatSessionsProvider`
 * proposal, because a plank that used the deprecated one would be no less a mirror.
 */
export const SESSION_MIRROR_MARKERS: readonly string[] = [
  'createChatSessionItemController',
  'registerChatSessionItemProvider',
];

/**
 * Words that say a command does something rather than shows something.
 *
 * `spawn`, `send`, `kill` and `mutate` are the four the design named. The rest are the words
 * people reach for instead when they mean the same thing, and leaving them out would have made
 * the rule a spelling test.
 */
export const EFFECT_VERBS: readonly string[] = [
  'spawn',
  'send',
  'kill',
  'mutate',
  'abort',
  'apply',
  'archive',
  'cancel',
  'close',
  'commit',
  'create',
  'delete',
  'destroy',
  'discard',
  'dispatch',
  'end',
  'exec',
  'execute',
  'fork',
  'interrupt',
  'launch',
  'merge',
  'patch',
  'pause',
  'post',
  'prune',
  'push',
  'rename',
  'restart',
  'resume',
  'retry',
  'run',
  'set',
  'start',
  'stop',
  'submit',
  'terminate',
  'update',
  'write',
];

const EFFECT_SET = new Set(EFFECT_VERBS);

/** Methods that are not a read. A mirror uses none of them. */
export const WRITE_METHODS: readonly string[] = ['POST', 'PUT', 'PATCH', 'DELETE'];

/**
 * `method: 'POST'` and its relatives, in the shapes an options object is written in.
 *
 * Matching the option rather than the bare word, so a comment may still say what the rule is
 * about and a route named `/deleted` is not a violation.
 */
const WRITE_METHOD_RE = new RegExp(
  String.raw`\bmethod\s*[:=]\s*['"\`](` + WRITE_METHODS.join('|') + String.raw`)['"\`]`,
  'gi',
);

/** `registerCommand('id'` / `registerTextEditorCommand("id"` — the ids a plank binds at runtime. */
const REGISTER_COMMAND_RE = /\bregister(?:TextEditor)?Command\s*\(\s*['"`]([^'"`]+)['"`]/g;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Split an identifier or a title into lowercase words: dots, dashes, spaces and camelCase. */
export function words(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter((w) => w !== '')
    .map((w) => w.toLowerCase());
}

/**
 * Does this command's name say it performs an effect?
 *
 * The id is read from its **last dotted segment** only. The namespace in front of it is the
 * plank's own name and is nobody's verb: `mewdBerths.revealInBerths` must not be flagged because
 * some plank one day is called `mewd.update-band`.
 */
export function isEffectCommand(commandId: string, title?: string): boolean {
  const segments = commandId.split('.');
  const leaf = segments[segments.length - 1] ?? commandId;
  const candidates = [...words(leaf), ...(title === undefined ? [] : words(title))];
  return candidates.some((word) => EFFECT_SET.has(word));
}

export interface ContributedCommand {
  readonly command: string;
  readonly title?: string;
}

/** `contributes.commands` out of a plank's `package.json`, or nothing if it has none. */
export function contributedCommands(packageJson: unknown): ContributedCommand[] {
  if (!isObject(packageJson)) return [];
  const contributes = packageJson['contributes'];
  if (!isObject(contributes)) return [];
  const commands = contributes['commands'];
  if (!Array.isArray(commands)) return [];
  const out: ContributedCommand[] = [];
  for (const entry of commands) {
    if (!isObject(entry)) continue;
    const id = entry['command'];
    if (typeof id !== 'string') continue;
    const title = entry['title'];
    out.push(typeof title === 'string' ? { command: id, title } : { command: id });
  }
  return out;
}

/** Command ids the plank binds in its own source. */
export function registeredCommands(sourceText: string): string[] {
  const found: string[] = [];
  for (const match of sourceText.matchAll(REGISTER_COMMAND_RE)) {
    const id = match[1];
    if (id !== undefined) found.push(id);
  }
  return found;
}

/** Does this plank put session items in front of the operator? */
export function registersSessionItems(sourceText: string): boolean {
  return SESSION_MIRROR_MARKERS.some((marker) => sourceText.includes(marker));
}

/**
 * Every way this plank's source builds a request that is not a read.
 *
 * This is the rule that does not depend on what anything was called. A read-only mirror has one
 * method, and the presence of another is the code saying so itself.
 */
export function scanWriteMethods(sourceText: string): string[] {
  const found: string[] = [];
  for (const match of sourceText.matchAll(WRITE_METHOD_RE)) {
    const method = match[1];
    if (method !== undefined) found.push(method.toUpperCase());
  }
  return [...new Set(found)];
}

/**
 * Check a session-mirror plank.
 *
 * Returns nothing at all for a plank that is not one — the caller decides that by handing this
 * function a manifest that declares the upstream point and a source that registers the items.
 */
export function checkSessionMirror(
  commands: readonly ContributedCommand[],
  sourceText: string,
): SessionMirrorHit[] {
  const hits: SessionMirrorHit[] = [];

  const seen = new Set<string>();
  const all: ContributedCommand[] = [...commands];
  for (const id of registeredCommands(sourceText)) {
    if (!commands.some((c) => c.command === id)) all.push({ command: id });
  }

  for (const entry of all) {
    if (seen.has(entry.command)) continue;
    seen.add(entry.command);
    if (!isEffectCommand(entry.command, entry.title)) continue;
    hits.push({
      ruleId: 'session-mirror-effect-command',
      message:
        `the command ${JSON.stringify(entry.command)}` +
        (entry.title === undefined ? '' : ` (${JSON.stringify(entry.title)})`) +
        ' names a fabric effect, and this plank mirrors the fabric’s sessions into the editor’s ' +
        'native session view — a surface whose every other occupant can stop, restart or discard ' +
        'what it lists. A mirror that can act on a session is a second place the fabric is ' +
        'changed from. Either the command goes, or this plank stops being a mirror.',
    });
  }

  for (const method of scanWriteMethods(sourceText)) {
    hits.push({
      ruleId: 'session-mirror-write-method',
      message:
        `the source builds a request with method ${JSON.stringify(method)} — a session mirror reads, ` +
        'and a read is a GET. This is not a matter of what the request was named: the method is the ' +
        'effect.',
    });
  }

  return hits;
}
