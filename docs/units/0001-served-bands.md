---
id: 0001-served-bands
title: The sign-in, the four served bands, and the first thing in the pack that reaches out
pathway: foundry
human_word:
  - dispatch
  - land
weight: W2
deps:
  - 0000-law-plank
design_ref: docs/units/0001-served-bands.md#spec
deliverables:
  - packages/fabric-auth — the mewd authentication provider, PKCE, SecretStorage, revoke on sign-out
  - packages/served-bands — four webview views, fetched by the extension host
  - packages/pack-lint/src/webview-guard.ts — the webview rules
  - packages/law-plank/src/propose.ts and src/mcp.ts — the propose grant, live
open_questions:
  - Whether the four bands stay one plank with one manifest, or become four manifests once a band needs a claim the others do not share.
  - Whether a token response that omits `scope` should be refused outright rather than kept as a session that satisfies nothing.
  - Whether the MCP client grows a session handshake at P2, or stays one request per call for as long as there is one tool.
status: landed
---

## Spec

### What this unit is

P0 made the pack able to describe and check itself. This unit makes it able to *see* something,
and — once, in one place — to *do* something.

Three things land together because they are one arrangement rather than three features. There is
a sign-in that holds a token. There are four views that need a bearer and must not hold one. And
there is a single MCP effect, which exists to prove that a grant written in a manifest can be a
real grant and still be the only one in the pack.

### The sign-in

`fabric-auth` registers one VS Code `AuthenticationProvider` under the id `mewd`. Everything else
asks for a bearer the ordinary way — `vscode.authentication.getSession('mewd', …)` — and nothing
else in the pack ever sees an authorization code, a verifier or a refresh token.

Authorization code with PKCE (`S256`), against a public client whose id the operator pastes into
`mewd.fabric.clientId`. Three absences are deliberate and each one is a decision rather than an
omission:

- **No dynamic client registration.** A client that can register itself can register itself
  again, and the set of clients permitted to ask for a constructor role stops being something
  anybody decided.
- **No client secret.** This is a public client on somebody's laptop. A secret shipped to one is
  not a secret, and carrying one would be a claim about the security model rather than a part of
  it.
- **No vendor identity provider and no tunnel.** The authorization request goes to the operator's
  browser and the answer comes back through the editor's own URI handler.

Tokens go to `SecretStorage` under one key. There is exactly one function that renders a session
as text and it carries no token, not even a prefix of one — a prefix is enough to correlate two
logs and tells a reader nothing the scopes do not.

**The role is the fabric's to give.** The plank asks for `role:constructor`; what it holds is
what the token response said it granted. A grant that comes back as `role:consult` does not
become a constructor session by having been requested as one: it is refused, the lineage that was
just issued is revoked on the way out, and the operator is told what they were actually given. A
response that does not say what it granted has granted nothing the plank will claim. That is the
same rule the rest of the pack runs on — a check that cannot read its input reports unknown,
never pass.

Signing out presents the **refresh** token to the revocation endpoint, which kills the family it
was issued from. A refresh lineage that survived a sign-out would make the word meaningless. The
local session is dropped whether or not the fabric could be reached.

### The four bands

One extension, four webview views in a Mew'd container:

| View | Band | Route |
|---|---|---|
| `mewd.needsYou` | Needs you | `/dashboard/attention` |
| `mewd.helm` | Helm | `/dashboard/coordination` |
| `mewd.berths` | Berths | `/dashboard/sessions` |
| `mewd.map` | Map | `/dashboard/chart` |

The shape is the whole of the argument:

```
webview  ──(ready | refresh | signIn)──▶  extension host  ──▶  authentication provider
   ▲                                            │
   └────────(loading | data | signIn | error)───┘ ──▶  <baseUrl>/dashboard/…
```

The **extension host** obtains the bearer, puts it on the request and posts rows to the page. The
**webview holds no token and fetches nothing**. Its content policy is `default-src 'none'` with
`connect-src 'none'` stated out loud even though the first clause already covers it, because that
is the clause that says what the plank is for. Its `localResourceRoots` is pinned to the
extension's own `media` directory.

Shaping a response into rows also happens in the host, which is not tidiness: it is what keeps
the page from ever needing code that walks an unknown object, which is the code that ends up
reaching for `innerHTML`.

A 401 becomes a **Sign in to Mew'd** button in the view. Pressing it posts a message; the host
calls the authentication provider; the browser that opens is opened by the editor. No page in
this pack navigates anywhere. A 403 is treated as a different thing and says so — the fabric
knows the session and declined the route, and signing in again would be theatre.

Why one manifest for four bands: the bands differ by a title and a route, and the pack's manifest
model is one `plank.yaml` per package. Four manifests would have meant four extensions — which
contradicts one container with four views — or a nested manifest the lint would have had to learn
to find. A claim that would be written four times identically is a claim about the plank. If a
band ever needs a claim the others do not share, that is the moment this splits, and it is the
first open question above.

### The webview rules

`pack-lint` gains a fourth check, over every asset under a plank's `media/` directory — exactly
the set a webview can load, because that is where `localResourceRoots` points:

| Rule | Fails on |
|---|---|
| `webview/token` | a credential named as a field, an `Authorization` header being set, a bearer or JWT written down |
| `webview/host-literal` | an absolute `http(s)` URL, apart from the XML namespaces an SVG cannot be written without |
| `webview/direct-fetch` | a request the page makes itself, by any of the five ways of making one |
| `webview/navigation` | a navigation the page performs — a 401 is an affordance, not a redirect |
| `webview/unsafe-render` | HTML assembled from data |
| `webview/csp` | a page with no content policy, or one that permits by default |

The patterns live in the file that defines them, the same way the private-reference patterns do.
A webview asset that spelled the forbidden APIs out in a comment would be arguing with its own
lint, so the assets do not, and the rules file does.

### The propose grant

`law-plank` holds one MCP grant: `propose`. It is the first effect from any plank in this pack
and, for now, the only one.

C5 already said an open question was standing, and never failed a unit for having one — a
document that admits what it does not know is behaving correctly. What it could not do at P0 was
help. Beside that finding there is now one action per question: propose it as an OIP. The plank
decides nothing. It takes a question that is already written down, hands it to the fabric's
`propose` tool with the bearer the editor is holding, and reports what came back.

Because the grant is written in `plank.yaml` and checked against the plank's own source, the two
cannot drift: delete the code and the lint fails the manifest as a dead grant; delete the grant
and the manifest stops describing the plank. `law-plank` is therefore now `effect-surfacing`, and
every band stays `render-only`.

Without a session the action is **inert** — not queued, not retried, and not a prompt that fires
something later. Every local thing the plank does goes on working.

### How this was built

Against **mocked** OAuth and served endpoints, start to finish. No fabric was read, no
authorization was granted, and no host appears anywhere in the tree — the fixtures use
`https://example.test`, which is reserved and resolves nowhere. The live bearer round-trip is the
operator's act on install, or a later unit; it is not a build-time check and this document does
not claim it as one.

### Not in this unit

Nothing is published to Open VSX; the name is recorded as free and left alone. No band writes
anything. No plank registers an MCP server with the editor, so `mcp-registration` stays
undeclared. And `terminal` is `NEVER-DECLARED` on all four planks, which is the one line in every
manifest that was never going to change.
