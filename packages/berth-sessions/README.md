# berth-sessions

The sessions the Mew'd fabric is holding, mirrored into the editor's own **Agent Sessions** view.

It is the same berths the P1 `mewd.berths` band shows, read from the same route, put where the
operator already looks for sessions. A second view of one thing — not a second source of it.

**It lists. It never acts.**

---

## The shape

```
Agent Sessions view  ──(refresh)──▶  extension host  ──▶  authentication provider (mewd)
       ▲                                   │
       └────────(items: label, state)──────┘ ──▶  GET <baseUrl>/dashboard/sessions
```

Three things about that diagram are the plank:

1. **The arrow out of the view is a refresh and nothing else.** No command here ends, starts or
   alters a session.
2. **The bearer is obtained in the extension host and stays there.** It goes onto one GET and is
   written into no item. Items are objects the editor keeps and carries across its own
   boundaries; a token in one would be a token in all of those places.
3. **The operator's origin stays there too.** Items are addressed by session id under this
   plank's own `mewd-berth:` scheme, never by the URL they came from, so a fabric address is
   never put into a `Uri` the editor stores and renders.

## Why read-only is a rule and not a README sentence

The editor's session list is not a page this pack drew. Every other provider that appears in it
offers a menu that stops a session, restarts one or throws one away, and an operator who has used
any of them will arrive at a mirrored berth expecting the same. If that expectation is ever met,
the fabric has a second front door.

So `pack-lint` checks it. A plank whose manifest declares `upstream: session-provider` and whose
source registers session items must not:

| Rule | Fails on |
|---|---|
| `plank/session-mirror-effect-command` | a command, contributed or bound, whose name says it does something to a session |
| `plank/session-mirror-write-method` | a request built with a method that is not a read |
| `plank/session-mirror-affordance` | a manifest claiming `effect-surfacing` while registering session items |

`fabric-auth` declares the same upstream point — it provides the authentication session in the
other sense of the word, and its sign-out legitimately revokes a refresh lineage. It is not a
session list, and the rules tell the two apart by the registration each one's source performs
rather than by what its manifest says.

## The one command

**Reveal in Mew'd Berths** (`mewdBerths.revealInBerths`) focuses the P1 Berths band. It takes no
argument, so nothing about the selected berth crosses into it; the band re-reads the fabric for
itself, with its own bearer, the way it always has. It reaches no origin.

## The proposed API

This plank is built against **`chatSessionsProvider`**, a *proposed* VS Code API. The declaration
in `types/` was fetched with [`@vscode/dts`](https://github.com/microsoft/vscode-dts):

```
npx @vscode/dts dev          # reads enabledApiProposals from package.json
```

It is kept in `types/` rather than `src/` on purpose: `pack-lint` concatenates a plank's
`src/*.ts` to check its manifest's claims against its own source, and a vendored declaration
naming every registration function in the proposal would let a plank pass the `upstream` check
without registering anything.

A proposed API is not a promise. It exists on a desktop build that has been told to enable it and
nowhere else. So the surface is **checked for, not assumed**, once, at activation — and if it is
absent the plank does nothing at all: no controller, no refresh, no read. There is no reduced
mode in which it still talks to the fabric, because a mirror with nowhere to render is a network
request with no reader.

**Not published.** An extension declaring `enabledApiProposals` is not marketplace-publishable,
so the Open VSX step is deferred rather than skipped. The `.vsix` builds, and installing it needs
the proposal enabled on the operator's own desktop.

## Configuration

None of its own. It reads `mewd.fabric.baseUrl` — the setting `fabric-auth` contributes — and
obtains its bearer through `vscode.authentication.getSession('mewd', …)` with `createIfNone`
false. There is no path in this plank that sets it true: the session view refreshes on the
editor's schedule, and a refresh that could open a browser tab would make an authorization prompt
a thing that happens to the operator rather than a thing they asked for. Signing in is
`fabric-auth`'s affordance, and stays there.

## How this was built

Against the mock payload in `test/mock-fabric.ts` and the vendored declaration, start to finish.
No private checkout was read and no live host was called; the route is known from the P1 band's
own table, which a test asserts it still agrees with. `test/no-mewd-source.test.ts` sweeps every
file in the package for the residue a different kind of build would have left.
