# law-plank

Diagnostics for unit documents, read from your workspace's own law.

Open a workspace that keeps `docs/units/*.md` and the plank starts. It reads three files —
**your** `docs/schema/unit.schema.json`, **your** `docs/deps.toml`, and the unit documents
themselves — and reports on the front matter of whatever you have open.

No copy of any schema ships inside this extension. If your workspace has no schema, the plank
says the front matter is *unknown*, not that it is clean.

## What it checks

| | |
|---|---|
| **schema** | Front matter against `docs/schema/unit.schema.json`. If the schema uses something the plank cannot check, it says so rather than passing you. |
| **C6** | The join closes: every id under `deps` resolves to a document in `docs/units`, and every one of those edges is also recorded in `docs/deps.toml`. |
| **C7** | The human words your declared `pathway` owes are present. `foundry` owes `dispatch` and `land`; `reviewed` owes `land`; `wayfinder` owes `hitl-resolve`; `direct` owes none. |
| **C8** | A unit at `W1` or above carries a `design_ref` and at least one deliverable. Below the threshold, neither is required — small work stays small. |
| **C5** | Open questions still standing. Informational, never a failure: a unit that admits what it does not know is behaving correctly. |

## Quick fixes

Three, each a single edit and nothing else:

- **record a missing edge** in `docs/deps.toml` (creating the file if you have none),
- **add a human word** the pathway owes,
- **insert the `design_ref` / `deliverables` skeleton** above the closing fence.

The skeleton is written with a `TODO` marker, and C8 goes on counting a `TODO` as missing. The
action is there to save you typing, not to let a unit through.

## Status bar

`law: n to fix` counts the errors and warnings across the unit documents you have open.
Informational findings are not things to fix, so they are not counted. Click it for the
Problems panel.

## What it will not do

It runs no shell — `terminal: NEVER-DECLARED` in [`plank.yaml`](plank.yaml), and `pack-lint`
enforces it. It makes no network request. It keeps nothing it cannot rebuild from your files.
Uninstalling it leaves your workspace exactly as it was.

Part of [argo-pack](https://github.com/knivriver-lab/argo-pack).
