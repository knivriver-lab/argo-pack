---
id: 0002-ticket-pathway-validation
title: Tickets, pathways, and the deletion of the last table the plank held on its own
pathway: foundry
human_word:
  - dispatch
  - land
weight: W2
deps:
  - 0000-law-plank
design_ref: docs/units/0002-ticket-pathway-validation.md#spec
deliverables:
  - packages/law-plank/src/ticket.ts — ticket diagnostics, the witness writer rule, the two conditionals
  - packages/law-plank/src/pathway.ts — pathway diagnostics, the joins, the assignment check
  - packages/law-plank/src/toml-lite.ts — the TOML reader the declarations are read with
  - packages/law-plank/src/finding.ts — the finding shape the four rule files share
  - docs/schema/pathway.schema.json and docs/pathways/*.toml — the pack's own pathways, declared
  - packages/law-plank/test/fixtures — a hand-authored workspace for the ticket rules to read
open_questions:
  - Whether `docs/tools.yml` is the right name for a tool manifest, or whether the plank should look for several and take the first it finds.
  - Whether T1's reach should stop at `witness` and `resolution.witness`, or go on covering every `*_witness` field a schema invents.
  - Whether a pathway declaration should be able to say it extends another, now that three of the four here repeat most of a fourth.
status: landed
---

## Spec

### What this unit is

The last plank of ARGO-5, and the one that takes the final constant out of `law-plank`.

P0 built the plank with five checks over unit documents and left one honest piece of debt: C7
read a table of four pathways held as a `const` in `law.ts`, with a comment saying P4 would
replace it with the workspace's own `docs/pathways/`. This unit does that, and adds the two
document kinds the same workspace keeps beside its units — tickets and the pathway declarations
themselves.

Everything it reads is read at runtime, out of the open workspace. Nothing is bundled. That was
already true of the unit schema and the dependency table; it is now true of six more files, and
[`test/runtime-reads.test.ts`](../../packages/law-plank/test/runtime-reads.test.ts) is what
makes it stay true.

### Tickets

A ticket is a piece of work the map knows about. `docs/map/tickets/*.md` opens with front matter
and carries two sections a person actually reads, `## Gist` and `## Resolution`.

The division of labour is worth stating, because it is the same one the whole plank keeps:

**The schema owns the shapes.** Which fields exist, what they may contain, the closed vocabulary
a `witness` is drawn from — all of it comes from *your* `docs/schema/ticket.schema.json`, read at
runtime. Where you have none, the verdict is unknown rather than clean.

**The plank owns what a schema cannot say.** Three rules:

| | |
|---|---|
| **T1** | A ticket may not stand on `witness: memory`. |
| **T2** | A `resolved` ticket carries a `resolution`. |
| **T3** | A `claimed` ticket carries the `claim_*` fields your schema names. |
| **T4** | `## Gist` is there and says something; `## Resolution` too, once the ticket is resolved. |

T1 is the one to read twice. The witness vocabulary *includes* `memory`, and it should: a
checkpoint tick may legitimately stand on somebody remembering, in the moment, inside a
conversation that is itself the record. A ticket is not that. A ticket outlives the conversation
it was written in, and a ticket whose witness is `memory` is a claim with nothing behind it by
the time anyone comes to check. The vocabulary is shared and the admissibility is not — which
means **no schema can express this rule**, because the schema cannot see which kind of thing is
being written. Only the writer knows. So the rule lives with the writer's tools.

T2 and T3 are conditionals: `required` cannot depend on the value of `status` in the schemas
people actually write, so a resolved ticket with no resolution passes every schema check there
is. Both come with a code action — "insert resolution skeleton", "insert claim block" — and both
actions write the field names **your schema names**, not a list held in the plank. Both write
`TODO` beside them, and both rules go on failing afterwards. The action saves typing; it does not
let a ticket through.

T2 checks only that the `resolution` block is *there*. What is inside it is the schema's business,
and checking it in both places would put the same complaint in front of a reader twice.

### Pathways

A pathway says how work reaches a person: what it may affect, what validates it, where somebody
gets a say, who can see it, what it may spend, how long it stands, and the stages it moves
through. `docs/pathways/*.toml` is where a workspace writes that down.

The vocabulary — the `effects` and `validation` enums, the `posture_budget` pattern, the shape of
a stage — lives in your `docs/schema/pathway.schema.json`. The plank carries no copy and holds no
second opinion. It reads the declaration with a small TOML reader that **reports every construct
it does not implement** rather than skipping it, because a pathway is not a file it is safe to
half-read.

What the plank adds on top is the joins, and it adds them with a rule about their limits:

- a stage's `verbs` are checked against your tool manifest **if you publish one**;
- `visibility` is checked against your `docs/surfaces.yml` **if you have one**;
- `posture_budget` and `approvals` resolve on the operator's side, against a budget and a roster
  the plank cannot see, so they are **never** checked.

Where a join cannot be closed, the finding is INFO and says "unknown" — never a silent pass, and
never a hard failure for something the author had no way to satisfy. That is the same principle
as the schema check reporting unknown rather than clean, applied to a join instead of a shape.

There is deliberately no way to write `posture_budget = "off"`. It is the shape somebody reaches
for when they want a pathway nobody is accounting for, and it is the shape the pattern refuses.

### C7, and the table that is gone

`PATHWAY_HUMAN_WORDS` has been deleted. C7 reads `docs/pathways/*.toml`.

That changes the direction of the check, and the change is the point. A constant table could only
say what a pathway *owes*. A declaration says what it *offers*, in its `approvals`. So:

- a `pathway` no file in `docs/pathways/` declares is an **error** — and it is the plank's own
  refusal, not a schema's. A unit may not run on a pathway nobody has written down, whatever any
  enum happens to permit. Where a workspace declares no pathways at all, C7 reports unknown.
- a `human_word` outside that pathway's `approvals` is an **error**: the unit is claiming a person
  gets a say at a point the pathway does not give one.
- a unit that claims *no* human words at all, on a pathway that offers some, is a **warning** with
  a fix per approval. Not an error — a unit may legitimately use fewer of the says a pathway
  offers than all of them — but a unit using none of them is nearly always an oversight.

`assignment.toml` is read lightly: the default pathway it names must resolve to a declared file.
Everything else in an assignment table is the operator's business.

### The pack's own pathways

Because C7 now demands a declaration, `argo-pack` has four: `foundry`, `reviewed`, `direct` and
`wayfinder`, in `docs/pathways/`, with `docs/schema/pathway.schema.json` beside them. They
describe how work reaches a person *here*, and they match the landing tiers in CONTRIBUTING.md.

That is the same arrangement as the unit schema, and for the same reason. The pack governs itself
by the law it offers; a rule that is painful to satisfy here would be painful to satisfy anywhere.
[`test/pathway.test.ts`](../../packages/law-plank/test/pathway.test.ts) reads the whole directory
rather than a list, so a fifth pathway is held to the law the moment it exists.

Note what `docs/pathways/direct.toml` says: `approvals = []`. That is a declaration, not an
omission — the pathway offers no say, and C7 reads the empty list exactly that way.

### The fixtures

The ticket rules need a workspace to read a ticket schema out of, and `argo-pack` keeps no ticket
log. So `packages/law-plank/test/fixtures/` is a small hand-authored tree: a ticket schema, three
tickets, a `surfaces.yml` and a `tools.yml`, and an `assignment.toml`. Every one of them was
written here, to the shape the rules are for. None is a copy of any workspace that keeps tickets,
and the no-private-source scan runs over the fixtures as well as over the source.

The fixture ticket schema is deliberately the sort a real workspace writes: it admits `memory` in
the witness pattern, leaves `resolution` unconditional and makes every `claim_*` field optional —
that is, it is permissive about exactly the three things T1, T2 and T3 exist to catch. A fixture
schema that already expressed those rules would have made the tests pass without testing anything.

The unit and pathway schemas are not fixtures: those are the repository's real ones, and the tests
read them off disk the way the plank reads yours.

### Not in this unit

No new MCP grant. `consumes.mcp_tools` is still `[propose]` and nothing else, because all of this
validation is local — the plank reads files and draws squiggles. No new command, no new webview,
no terminal. Nothing is published to Open VSX. The `.vsix` still carries no schema, no unit, no
ticket, no pathway and no dependency table, and there is now a test that reads the archive's own
entry names to say so.
