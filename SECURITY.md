# Security policy

## Reporting a vulnerability

Report privately through GitHub's **Report a vulnerability** button on the repository's
Security tab. Please do not open a public issue for anything exploitable.

Include what you did, what happened, and what you expected. A proof of concept helps but is
not required. We will acknowledge receipt and tell you whether we consider it in scope; if it
is, we will tell you when a fix has landed.

## What this pack promises

These promises are enforced by `pack-lint` and by the test suite, not only by review. If you
find a way to break one of them, that is a vulnerability in this pack even if nothing else
goes wrong.

- **No plank runs a shell.** Every manifest declares `terminal: NEVER-DECLARED`, and the lint
  rejects any other value. Code actions produce a single `WorkspaceEdit` and nothing else.
- **No plank holds durable state.** `state_policy` is `cache-only`. Uninstalling a plank
  returns the workspace to where it started (`swap_invariant: install-uninstall`).
- **Declared tool grants are real grants.** If a manifest lists an MCP tool under `consumes`
  that the plank's own source never references, the lint fails it as a dead grant. A plank
  cannot accumulate permissions it does not use.
- **Workspace schemas are read, never carried.** `law-plank` resolves
  `docs/schema/unit.schema.json` from the open workspace at runtime. No copy of any
  workspace's schema is bundled into a `.vsix`, and a test asserts it.
- **No telemetry, no network egress, no tunnels.** The planks in this pack make no outbound
  connections of any kind.

## What is out of scope

- The behaviour of the editor host itself, or of any MCP server a plank talks to.
- Findings that require an attacker to already have write access to the open workspace. A
  plank reads workspace files as data; so does every other extension.
- Anything in a fork or in an unreleased branch.

## Supported versions

The most recent release is supported. Fixes land on `main` and ship in the next `.vsix`.
