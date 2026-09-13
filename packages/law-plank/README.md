# law-plank

Diagnostics for unit documents, tickets and pathway declarations — read from your workspace's own
law.

Open a workspace that keeps `docs/units/*.md`, `docs/map/tickets/*.md` or `docs/pathways/*.toml`
and the plank starts. Everything it checks against belongs to you:

| It reads | For |
|---|---|
| `docs/schema/unit.schema.json` | unit front matter |
| `docs/schema/ticket.schema.json` | ticket front matter |
| `docs/schema/pathway.schema.json` | pathway declarations |
| `docs/units/*.md`, `docs/deps.toml` | the dependency join |
| `docs/pathways/*.toml` | which pathways exist, and what each one offers |
| `docs/surfaces.yml`, `docs/tools.yml` | the pathway joins, if you publish them |
| `assignment.toml` | the default pathway, checked lightly |

**No copy of any schema ships inside this extension.** Where your workspace has none of a thing,
the plank says the answer is *unknown*, not that it is clean. A check that cannot read its input
has not passed.

## Unit documents

| | |
|---|---|
| **schema** | Front matter against `docs/schema/unit.schema.json`. If the schema uses something the plank cannot check, it says so rather than passing you. |
| **C6** | The join closes: every id under `deps` resolves to a document in `docs/units`, and every one of those edges is also recorded in `docs/deps.toml`. |
| **C7** | Your declared `pathway` is one `docs/pathways/` actually declares, and every `human_word` you claim is one that pathway's `approvals` offers. |
| **C8** | A unit at `W1` or above carries a `design_ref` and at least one deliverable. Below the threshold, neither is required — small work stays small. |
| **C5** | Open questions still standing. Informational, never a failure: a unit that admits what it does not know is behaving correctly. |

C7 holds no table of pathways. A pathway it cannot find in your `docs/pathways/` is an error —
a unit may not run on a pathway nobody has written down.

## Tickets

| | |
|---|---|
| **schema** | Front matter against `docs/schema/ticket.schema.json`, including whatever closed vocabulary you give `witness`. |
| **T1** | A ticket may not stand on `witness: memory`. |
| **T2** | A `resolved` ticket carries a `resolution`. |
| **T3** | A `claimed` ticket carries the `claim_*` fields *your* schema names. |
| **T4** | `## Gist` is there and says something — and `## Resolution` too, once the ticket is resolved. |

T1 is the one worth explaining. Your vocabulary may well admit `memory`, and it should: a
checkpoint tick can legitimately stand on somebody remembering, inside a conversation that is
itself the record. A ticket is not that. It outlives the conversation it was written in, and a
ticket witnessed by memory is a claim with nothing behind it by the time anyone checks. No schema
can express that, because the schema cannot see which kind of thing you are writing. So the plank
does.

T2 and T3 are conditionals for the same reason: `required` cannot depend on the value of `status`
in the schemas people actually write.

## Pathway declarations

Validated against your `docs/schema/pathway.schema.json` — the enums, the budget pattern and the
shape of a stage are all yours. On top of that the plank closes what joins it can:

- a stage's `verbs` against your tool manifest, **if you publish one**;
- `visibility` against your `docs/surfaces.yml`, **if you have one**;
- `posture_budget` and `approvals` — never. They resolve on your side, against a budget and a
  roster the plank cannot see, and it says so rather than pretending to check them.

Where a join cannot be closed the finding is informational and says *unknown*. Never a silent
pass; never a hard failure for something you had no way to satisfy.

The TOML reader covers what these files use and **reports anything it does not implement** rather
than skipping it. A pathway is not a file it is safe to half-read.

## Quick fixes

Five, each a single edit and nothing else:

- **record a missing edge** in `docs/deps.toml` (creating the file if you have none),
- **add a human word** the pathway offers,
- **insert the `design_ref` / `deliverables` skeleton** above the closing fence,
- **insert the resolution skeleton** into a resolved ticket,
- **insert the claim block** into a claimed ticket.

The last two write the field names *your* schema names. All of them write `TODO`, and every rule
goes on failing afterwards. The actions save you typing; they do not let a document through.

## Status bar

`law: n to fix` counts the errors and warnings across the documents you have open. Informational
findings are not things to fix, so they are not counted. Click it for the Problems panel.

## What it will not do

It runs no shell — `terminal: NEVER-DECLARED` in [`plank.yaml`](plank.yaml), and `pack-lint`
enforces it. It makes one network request in one place and only when you press it: "propose this
open question as an OIP". It keeps nothing it cannot rebuild from your files. Uninstalling it
leaves your workspace exactly as it was.

Part of [argo-pack](https://github.com/knivriver-lab/argo-pack).
