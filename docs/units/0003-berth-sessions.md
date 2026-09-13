---
id: 0003-berth-sessions
title: The berths, mirrored into the view the operator was already looking at
pathway: foundry
human_word:
  - dispatch
  - land
weight: W1
deps:
  - 0001-served-bands
design_ref: docs/units/0003-berth-sessions.md#spec
deliverables:
  - packages/berth-sessions — the read-only session-provider adapter, and the one deep-link command
  - packages/berth-sessions/types/vscode.proposed.chatSessionsProvider.d.ts — the proposed API, vendored via @vscode/dts
  - packages/pack-lint/src/session-mirror-guard.ts — the rules that hold a session mirror to reading
open_questions:
  - Whether the mirror should stay itemless on a payload with no list in it, or grow the band's habit of showing what it could not read once there is somewhere in a session list to put that.
  - Which activation event the editor actually raises for a contributed chat session type, so the plank can stop activating on startup and start activating when its view is asked for.
  - Whether a berth should become openable — a content provider serving the transcript read-only — or whether the deep link to the band is the right and final answer.
  - What the Open VSX story is for an extension that cannot be published while it depends on a proposal.
status: landed
---

## Spec

### What this unit is

P1 gave the pack four bands in a container of its own. This unit takes one of them — Berths — and
puts it somewhere the operator was already looking.

That is the whole of the argument. The editor has a native session list. An operator running
agent sessions is in it already, several times a day, and the Mew'd berths were not: they were in
a Mew'd container, behind a Mew'd icon, one click away and one habit away. A view nobody opens is
a view that does not exist, and the fix is not a better band.

Nothing new is read. Same route, same shape, same bearer, second surface.

### Read-only, and why that is the interesting part

The Berths **band** is read-only too, and nobody had to say so. It is a webview this pack drew;
there was never an affordance in it because none was written.

The native session list is not that. It is a surface the **editor** owns, and every other
provider that appears in it offers a menu that stops a session, restarts one, or throws one away.
An operator who has used any of them will arrive at a mirrored berth with an expectation, and the
expectation is wrong. If it is ever met, the fabric has a second front door — one opened from a
view whose entire claim was that it only looks, reached by an operator who did not necessarily
know which fabric they were pointed at.

So `render-only` on this manifest is doing work it does not do on the bands, and "it only reads"
is not a thing to write in a README. `pack-lint` gains a third rule family:

| Rule | Fails on |
|---|---|
| `plank/session-mirror-effect-command` | a command, contributed or bound in source, whose name says it does something to a session |
| `plank/session-mirror-write-method` | a request built with a method that is not a read |
| `plank/session-mirror-affordance` | a manifest claiming `effect-surfacing` while registering session items |

The first rule is a list of verbs, and a list of verbs is a weak instrument. It is worth having
because the case that actually occurs is the honest one — somebody adds "Stop session" because
the surface invited it — and worth being clear-eyed about, because it will never catch a command
called `doTheThing`. The second rule is the one with teeth: a mirror that only reads makes
requests of one kind, and a request built any other way is a fact about the code rather than a
fact about its naming.

**What makes a plank a session mirror** is both halves: its manifest declares
`upstream: session-provider` *and* its source registers session items. `fabric-auth` declares the
same upstream point — it provides the authentication session everything borrows a bearer from —
and its sign-out really does revoke a refresh lineage on the fabric. That is an effect, it is
declared as one, and it is not a session list. The rules tell the two apart by what each plank's
source registers, which is the same way the pack has always checked a manifest's claims.

This required the one `session-provider` entry in the `upstream` enum to answer to two
registrations rather than one. The alternative was a second enum value, which would have meant
editing `schemas/` to describe a distinction the editor itself does not make: both are session
providers, and the word is the editor's.

### The token, and the address

The bearer is obtained by the extension host and put on one GET. It is written into no item.

That rule is the same one the bands run on, and it is stricter here rather than looser. A band's
rows go into a webview this pack controls. An **item** goes to the editor, which keeps it, passes
it across its own process boundaries, and may render it in places this plank never sees. A token
in one would be a token in all of them.

There is a second leak this surface invites and the bands did not. The obvious way to give a
mirrored session a stable identity is to make its resource the URL it was read from — and that
URL contains the operator's fabric origin, which would then be in a `Uri` the editor stores,
shows on hover, and may write into its own state. So items are addressed by the fabric's session
id under this plank's own `mewd-berth:` scheme, and the origin stays in the extension host where
the request was made. Both claims are tested by serialising what the editor is handed and
searching the text, which is duller than reading the types and more honest: it catches a token
that arrived inside a `detail` string because the fabric put it there.

### The one command

**Reveal in Mew'd Berths** focuses the P1 `mewd.berths` view. That is a focus call on a view id
`served-bands` caused to exist.

It takes no argument. Nothing about the selected berth crosses into it, and the band re-reads the
fabric for itself with its own bearer, exactly as it did before. There is no session, no url and
no bearer it could be given — which is why "performs no fabric call" is a property a test can
assert rather than a sentence.

### The proposed API, and the halt that did not happen

Built against **`chatSessionsProvider`**, fetched with `@vscode/dts` and vendored into `types/`.

This was a gate. The instruction was to resolve the proposal or stop — not to guess an API shape
and not to quietly substitute the stable-TreeView fallback, which is a re-scope decision and not
a build decision. The proposal resolved, so the fallback was never reached and this document does
not claim it as an option that was weighed.

The declaration lives in `types/` rather than `src/`, which is not tidiness. `pack-lint`
concatenates a plank's `src/*.ts` to check its manifest against its own source. A vendored
declaration naming every registration function in the proposal would sit in that concatenation
and let a plank pass the `upstream` check without registering anything — a lint reading a
type definition and calling it evidence of behaviour.

A proposed API is not a promise: it exists on a desktop build told to enable it and nowhere else.
So the surface is checked for at activation, by testing for the exact method that will be called
rather than by comparing a version — a version says what build this is, not whether the operator
enabled the proposal. If it is absent, the plank does **nothing**: no controller, no refresh, no
read. There is no reduced mode in which it still talks to the fabric, because a mirror with
nowhere to render is a network request with no reader.

### Not in this unit

**Nothing is deployed.** The `.vsix` builds and is the operator's to install, and installing it
needs the proposal enabled on their own desktop. No fabric was read, no host was called, and no
session was mirrored anywhere during this build — the whole of it ran against a mock payload and
the vendored declaration.

**Nothing is published.** An extension declaring `enabledApiProposals` is not
marketplace-publishable, so Open VSX is deferred rather than skipped, and `open-vsx` stays
undeclared in the manifest. That deferral is an open question above rather than a decision.

**No content provider.** A mirrored berth lists; it does not open. There is no transcript behind
these resources, and the deep link to the band is what a reader gets instead. Whether that is the
final answer is the third open question.

**No new activation event.** The plank activates on startup and returns immediately when the
proposal is absent, because the event the editor raises for a contributed session type was not
something this build could confirm, and an activation event invented from a plausible pattern is
the same class of mistake as an invented API shape. It is written down as a question rather than
guessed at.
