# argo-pack

**A pack of small, honest editor planks.**

`argo-pack` builds *planks* — narrow VS Code extensions that each do one legible thing and
declare, in a machine-checked manifest, exactly what they are allowed to reach for. A plank is
not a platform. It renders what it can prove and says nothing it cannot.

The pack is public and self-contained. It reads your workspace's own files at runtime; it
carries none of them.

## What a plank is

Every package under `packages/` ships a `plank.yaml` alongside its code. The manifest is
validated against [`schemas/plank.schema.json`](schemas/plank.schema.json) by
[`pack-lint`](packages/pack-lint) on every commit. It records:

| Field | Meaning |
|---|---|
| `plank` | Stable id, `mewd.<name>` |
| `face` | Which surface of the editor the plank presents on |
| `keel` | The workspace shapes this plank is built to float on |
| `consumes` | The MCP tools and streams the plank may call — **by name, nothing else** |
| `affordance_class` | `render-only` (draws) or `effect-surfacing` (draws a thing you may then do) |
| `state_policy` | `cache-only` — a plank owns no durable state |
| `swap_invariant` | `install-uninstall` — installing and uninstalling must return you to where you started |
| `upstream` | Which editor extension points the plank actually uses |
| `terminal` | `NEVER-DECLARED`, always. No plank in this pack runs a shell. |

Those last two lines are the point of the whole exercise. A plank that cannot open a terminal
cannot quietly become something else, and a plank whose declared tool grants are checked
against its own source cannot hold a permission it never uses.

## The planks

### `law-plank`
Diagnostics for unit documents, tickets and pathway declarations. Point it at a workspace that
keeps `docs/units/*.md`, `docs/map/tickets/*.md` or `docs/pathways/*.toml` and it reads **that
workspace's own** schemas — never a bundled copy — then reports: schema conformance, dependency
joins that don't close, a `human_word` the declared pathway does not offer, thin design
references on heavy units, and open questions still standing.

On tickets it adds the rules no schema can carry — a ticket may not stand on `witness: memory`,
a resolved one carries its resolution, a claimed one carries its claim block. On pathways it
validates the declaration and closes what joins the workspace exposes, reporting the rest as
*unknown* rather than as a pass.

Fixes are offered as single-edit code actions. It never shells out.

Its one MCP grant — `propose` — is the only one in the pack. Beside an open question it
already found, it offers to propose that question as an OIP. The proposing is yours: nothing is
sent until you choose it.

### `fabric-auth`
The sign-in, and the only plank that ever holds a token. One `AuthenticationProvider` under the
id `mewd`: authorization code with PKCE, against a **public client** whose id you paste into
settings. No dynamic registration, no client secret, no vendor identity provider, no tunnel.
Tokens live in `SecretStorage`; signing out presents the refresh token to the fabric's revoke
path, which kills the family it came from.

The role is the fabric's to give. The plank *asks* for `role:constructor` and *holds* whatever
the token response said it granted — a `role:consult` grant does not become a constructor
session by having been requested as one.

### `served-bands`
Four views of a fabric in one activity-bar container: **Needs you**, **Helm**, **Berths** and
**Map**. Each is one served route.

The extension host holds the bearer, makes the request and posts rows to the webview. The
webview has no URL, no header and no credential; its policy is `default-src 'none'` with
`connect-src 'none'` said out loud, and `pack-lint` fails the build if a webview asset gains a
token, a host literal, a request of its own or a navigation. A 401 becomes a **Sign in to
Mew'd** button — an affordance in the view, never a redirect.

### `hello-band`
A twenty-line webview. It exists to prove the frame and theme-token plumbing, and to be the
smallest possible thing that is still a plank.

## Using it

```sh
npm install
npm run lint     # pack-lint: manifests, private refs, bundles, webviews
npm test         # vitest
npm run build    # tsc, then a .vsix per plank
```

Each plank builds to its own `.vsix` in `dist/`. Install one with
`code --install-extension dist/<name>.vsix`. `served-bands` needs `fabric-auth` beside it, and
both need two settings — there are no defaults, because this repository names no host of
anyone's:

| Setting | What it is |
|---|---|
| `mewd.fabric.baseUrl` | Origin of your fabric. `https`, or `http` on loopback. |
| `mewd.fabric.clientId` | The public OAuth client id your fabric issued for this editor. |

## The pack governs itself

`argo-pack` keeps its own `docs/units/` and its own `docs/schema/unit.schema.json`, and
`law-plank` reads them the same way it reads yours. If the law is worth applying to a
workspace, it is worth applying here first.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Every commit is signed off (DCO). Every change runs
`pack-lint`, the test suite, a private-reference scan and a secret scan before it can land.

## Licence

MIT — see [LICENSE](LICENSE).
