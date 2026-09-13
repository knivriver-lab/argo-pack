---
id: 0000-law-plank
title: The law plank, the pack around it, and the lint that holds both honest
pathway: foundry
human_word:
  - dispatch
  - land
weight: W2
deps: []
design_ref: docs/units/0000-law-plank.md#spec
deliverables:
  - schemas/plank.schema.json — the plank manifest schema
  - packages/pack-lint — manifest validation, dead-grant and private-ref checks
  - packages/law-plank — diagnostics and quick fixes for unit documents
  - packages/hello-band — the webview plumbing proof
  - .github/workflows/checks.yml and land.yml — the checks, and the routine landing tier
open_questions:
  - Whether keel stays a single value or becomes a list once a second workspace shape exists.
  - Whether C7's pathway table moves to docs/pathways/ at P4, or earlier if a fifth pathway lands.
status: landed
---

## Spec

### What this unit is

The first unit of `argo-pack`, and the one that makes the repository able to govern itself. It
builds four things: the manifest schema every plank is described by, the lint that checks those
descriptions against the planks' own source, the plank that reads this law, and the smallest
possible webview to prove the frame plumbing.

The pack keeps its own `docs/units/` and its own `docs/schema/unit.schema.json`, and `law-plank`
reads them at runtime the same way it reads any other workspace's. This document is the first
thing it reads. That is the point: if the law is worth applying to a workspace, it is worth
applying here first, and a rule that is painful to satisfy here will be painful to satisfy
anywhere.

### The manifest

`schemas/plank.schema.json` describes a plank in ten fields. Three of them are constants —
`state_policy: cache-only`, `swap_invariant: install-uninstall`, `terminal: NEVER-DECLARED` —
and they are constants because they are the promises the pack exists to make. A plank that owns
no durable state can be uninstalled without consequence. A plank that cannot open a terminal
cannot quietly become something else.

`keel` is a closed enum, initially `["mewd"]`. A plank may not invent a keel, because the keel is
what tells a reader which workspaces the plank's assumptions are worth anything in.

`upstream` is a closed enum of editor extension points. `consumes` names the MCP tools and
streams a plank may reach for. Both are claims about the code, and the lint checks them against
the code rather than taking them on trust.

### The lint

`pack-lint` validates every manifest against the schema, then fails on four things the schema
alone cannot see:

- a `keel` outside the published set,
- an `upstream` outside the enum, or one declared but never registered,
- `terminal` set to anything other than `NEVER-DECLARED`,
- a **dead grant** — an MCP tool listed under `consumes` that the plank's own source never
  names. A permission held for no reason is how a small tool stops being small.

It also scans the whole tree for private references. `argo-pack` is public; host names,
addresses, home paths and internal deployment names must not appear anywhere in it. The patterns
are shapes rather than a list of names, because a public repository carrying the list of things
it is trying not to mention would be the leak. Extra literal terms arrive through
`PACK_LINT_DENY` from a private environment and are never recorded here.

And it runs a third check over the built payload: no plank may carry a copy of a workspace's
files. `law-plank` names `docs/schema/unit.schema.json`, `docs/units` and `docs/deps.toml`, and
reads all three at runtime; none of them is inside a `.vsix`.

### The law plank

Five checks over a unit document's front matter, none of which imports an editor API:

| | |
|---|---|
| schema | against the workspace's own `docs/schema/unit.schema.json`, read at runtime |
| C6 | every id under `deps` resolves in `docs/units`, and each edge is recorded in `docs/deps.toml` |
| C7 | the human words the declared `pathway` owes are present |
| C8 | a unit at `W1` or above carries a `design_ref` and at least one deliverable |
| C5 | open questions are still standing — informational, never a failure |

Two of those deserve their reasoning written down. **The schema check reports unknown, not
clean**, when the workspace has no schema or uses a construct the validator cannot honour; a
check that cannot read its input has not passed. And **C5 is never a failure**: a unit that
admits what it does not know is behaving correctly, and a rule that punished it would teach
people to stop writing questions down.

The three quick fixes are each a single `WorkspaceEdit`. The `design_ref` skeleton writes a
`TODO` marker, and C8 goes on counting a `TODO` as missing — the action saves typing, it does
not let a unit through.

### The webview

`hello-band` loads one static page from its own bundle, with `localResourceRoots` pinned to its
own `media` directory so the page cannot reach the open workspace even by accident. It exists so
that the frame, the content-security policy, the nonce and the theme-token bridge are exercised
by something small enough to read in a minute.

### Landing

`unit/*` is the routine tier and auto-lands as one squash commit once `checks` is green.
`change/*` is reviewed; `keel/*` is structural and never auto-lands. Anything touching
`schemas/`, the lint rules, the workflows or the licence is structural whatever the branch is
called.

### Not in this unit

No MCP call, and no grant for one — `consumes` is empty on both planks, and the lint would fail
a grant added ahead of the code that uses it. Nothing is published to Open VSX. The pathway table
C7 uses is a constant here; reading `docs/pathways/` from the workspace is P4's job.
