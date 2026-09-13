/**
 * The desktop guard.
 *
 * This plank is built against a **proposed** API. A proposed API is not a promise: it exists on
 * a desktop build that has been told to enable it, and it does not exist anywhere else — not in
 * a web editor, not in a stable desktop without the flag, and not necessarily in the next
 * version of either. Code that assumed otherwise would throw on activation and take the rest of
 * the extension's activation with it.
 *
 * So the surface is checked for rather than assumed, once, at activation. If it is absent the
 * plank does nothing at all: no controller, no refresh, no read. That is a stronger claim than
 * "it degrades gracefully" — there is no reduced mode here in which it still talks to the
 * fabric, because a mirror with nowhere to render is a network request with no reader.
 *
 * The check is a function-presence test rather than a version comparison. A version number says
 * what build this is; it does not say whether the operator enabled the proposal, and the thing
 * that matters is whether the method is there to call.
 */

/** The proposal this plank declares in `enabledApiProposals`, recorded once, here. */
export const SESSION_API_PROPOSAL = 'chatSessionsProvider';

/**
 * The member the plank actually calls. Checking for the exact method that will be invoked, and
 * not for the namespace that contains it, is what keeps this honest: `vscode.chat` exists on
 * builds that carry none of this proposal.
 */
export const SESSION_API_MEMBER = 'createChatSessionItemController';

/**
 * Is the session-provider surface present on this build?
 *
 * Takes the namespace as an argument rather than importing it, so the absent case is a thing a
 * test can construct instead of a thing that can only be observed on the wrong editor.
 */
export function hasSessionProviderApi(chat: unknown): boolean {
  if (typeof chat !== 'object' || chat === null) return false;
  return typeof (chat as Record<string, unknown>)[SESSION_API_MEMBER] === 'function';
}

/** What the log says when the plank has decided to do nothing. */
export const INERT_REASON =
  `This editor does not expose the ${SESSION_API_PROPOSAL} proposed API, so the Mew’d berths are not ` +
  'mirrored into the native session view. Nothing was read and nothing was registered; the Mew’d ' +
  'Berths band is unaffected and remains the place the sessions are shown.';
