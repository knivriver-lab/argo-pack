# Contributing to argo-pack

## Sign your work — the Developer Certificate of Origin

Every commit must carry a `Signed-off-by` line. Adding it certifies the
[Developer Certificate of Origin 1.1](https://developercertificate.org/), reproduced below.

Use `git commit -s` and git adds it for you:

```
Signed-off-by: Your Name <your.email@example.com>
```

The name and email must be real and must match the commit author. CI rejects any commit in a
pull request without a matching sign-off.

<details>
<summary>Developer Certificate of Origin 1.1</summary>

```
By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I
    have the right to submit it under the open source license
    indicated in the file; or

(b) The contribution is based upon previous work that, to the best
    of my knowledge, is covered under an appropriate open source
    license and I have the right under that license to submit that
    work with modifications, whether created in whole or in part
    by me, under the same license (unless I am permitted to submit
    under a different license), as indicated in the file; or

(c) The contribution was provided directly to me by some other
    person who certified (a), (b) or (c) and I have not modified
    it.

(d) I understand and agree that this project and the contribution
    are public and that a record of the contribution (including all
    personal information I submit with it, including my sign-off) is
    maintained indefinitely and may be redistributed consistent with
    this project or the open source license(s) involved.
```

</details>

## Branches and landing

Branches are named by what they carry:

| Prefix | Tier | How it lands |
|---|---|---|
| `unit/*` | **routine** | Auto-lands on green. `land.yml` squash-merges it once every required check passes. |
| `change/*` | **reviewed** | Needs one approving review, then squash-merge. |
| `keel/*` | **structural** | Needs review *and* an explicit maintainer land. Never auto-lands. |

Anything that alters `schemas/`, the lint rules, the CI workflows, or the licence is
structural, whatever the branch is called. Use `keel/*` for it.

Every branch lands as **one squash commit** onto `main`. `main` is protected; there is no
direct push.

## Before you open a pull request

```sh
npm install
npm run lint     # pack-lint: manifests, dead grants, private refs
npm test         # vitest
npm run build    # tsc + .vsix per plank
```

All four must be clean. CI runs the same four plus a secret scan, a DCO check and a licence
check.

## House rules

- **No plank declares a terminal.** Not behind a flag, not for debugging. The lint enforces it.
- **Declare only what you use.** If you add an MCP tool to `consumes.mcp_tools`, the plank's
  source must reference it by name, or the lint fails it as a dead grant. Remove grants when
  you remove the code.
- **Never bundle a workspace's files.** Schemas, unit documents and dependency files belong to
  the workspace that is open; read them at runtime and handle their absence gracefully.
- **No private references.** Host names, IP addresses, home-directory paths and internal
  deployment names must not appear anywhere in the tree — not in code, not in tests, not in
  fixtures. `pack-lint` scans for them. Fixtures use obviously-fictional values.
- **Code actions are a single `WorkspaceEdit`.** No shell, no multi-step orchestration, no
  prompts that fire commands.
- **New rules ship with fixtures.** A diagnostic rule needs a passing fixture and a failing
  one.

## Adding a plank

1. `packages/<name>/` with a `package.json`, a `tsconfig.json` and a `plank.yaml`.
2. Add the workspace entry to the root `package.json` if the glob does not already cover it.
3. Fill in the manifest honestly. `keel` must be a value in the published enum; `upstream`
   must list the extension points you actually register; `terminal` is `NEVER-DECLARED`.
4. `npm run lint` until it is quiet.

## Code of conduct

Be straightforward and be kind. Disagree about the work, not about the person. Maintainers
may remove contributions and contributors that make the project worse to work on.
