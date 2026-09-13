/**
 * The one command this plank contributes, and the reason it is the only one.
 *
 * The native session view invites effects. Every other list like it in the editor has a context
 * menu that stops something, restarts something or throws something away, and the shape of the
 * surface will keep suggesting that this one should too. It does not. The supervisor's sessions
 * are the supervisor's; a mirror that could end one would be a second place from which the
 * fabric can be changed, and the fabric would then have two front doors with one lock between
 * them.
 *
 * So there is exactly one thing the operator can do from a mirrored berth, and it is to go and
 * look at the berth in the place that already shows it: the P1 `mewd.berths` band. That is a
 * focus call on a view id. It sends nothing, it reaches no origin, and there is no argument it
 * could be given that would make it reach one — the command below takes no session, no url and
 * no bearer, which is why the test that proves it performs no fabric call can be written at all.
 */

/** The command id contributed in `package.json`. */
export const REVEAL_COMMAND = 'mewdBerths.revealInBerths';

/** The P1 band this deep-links to. Contributed by `served-bands`, owned by it, focused here. */
export const BERTHS_VIEW_ID = 'mewd.berths';

/**
 * The editor's own focus command for a contributed view. It is generated from the view id, so
 * this plank is not inventing a command — it is calling one `served-bands` caused to exist.
 */
export const BERTHS_FOCUS_COMMAND = `${BERTHS_VIEW_ID}.focus`;

/** `vscode.commands.executeCommand`, structurally, so the deep link can be driven by a spy. */
export type CommandRunner = (command: string, ...args: readonly unknown[]) => Thenable<unknown>;

/**
 * Focus the Berths band.
 *
 * Note what is absent: no parameter, so nothing about the selected berth crosses into this call.
 * The band re-reads the fabric for itself, with its own bearer, the way it always has. This
 * plank hands it nothing and asks it for nothing.
 */
export async function revealInBerths(run: CommandRunner): Promise<void> {
  await run(BERTHS_FOCUS_COMMAND);
}
