---
id: T-0003
title: A claimed ticket, carrying the whole claim block
status: claimed
created: 2026-09-01
witness: approval:argo-p4
valid_at: 2026-09-01
deps: []
gist: The claimed fixture — somebody holds this, until a stated time, and says how it comes back.
claim_by: operator
claim_at: 2026-09-10
claim_ttl: P14D
claim_pathway: foundry
claim_witness: approval:argo-p4
claim_release: the ttl runs out, or the claimant says so
---

## Gist

A claim that answers the questions a claim has to answer: who holds it, since when, for how
long, on which pathway, on what authority, and what makes it come back.

The negative case in the tests is this document with every `claim_*` line removed. The schema
does not mind — those fields are optional in it, as they are in most real ticket schemas,
because a schema cannot make them conditional on `status`. The plank's T3 rule minds.
