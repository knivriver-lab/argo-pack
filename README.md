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
Diagnostics for unit documents. Point it at a workspace that keeps `docs/units/*.md` and it
reads **that workspace's own** `docs/schema/unit.schema.json` — never a bundled copy — then
reports on front matter: schema conformance, dependency joins that don't close, missing
human words for the declared pathway, thin design references on heavy units, and open
questions still standing. Fixes are offered as single-edit code actions. It never shells out.

### `hello-band`
A twenty-line webview. It exists to prove the frame and theme-token plumbing, and to be the
smallest possible thing that is still a plank.

## Using it

```sh
npm install
npm run lint     # pack-lint over every packages/*/plank.yaml
npm test         # vitest
npm run build    # tsc, then a .vsix per plank
```

Each plank builds to its own `.vsix` in `dist/`. Install one with
`code --install-extension dist/<name>.vsix`.

## The pack governs itself

`argo-pack` keeps its own `docs/units/` and its own `docs/schema/unit.schema.json`, and
`law-plank` reads them the same way it reads yours. If the law is worth applying to a
workspace, it is worth applying here first.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Every commit is signed off (DCO). Every change runs
`pack-lint`, the test suite, a private-reference scan and a secret scan before it can land.

## Licence

MIT — see [LICENSE](LICENSE).
