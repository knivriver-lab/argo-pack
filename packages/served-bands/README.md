# served-bands

Four views of the Mew'd fabric, in one container in the activity bar.

| View | Band | Route |
|---|---|---|
| `mewd.needsYou` | Needs you | `/dashboard/attention` |
| `mewd.helm` | Helm | `/dashboard/coordination` |
| `mewd.berths` | Berths | `/dashboard/sessions` |
| `mewd.map` | Map | `/dashboard/chart` |

The origin comes from `mewd.fabric.baseUrl`. There is no default and no host anywhere in this
repository.

## Where the token is

In the extension host, and nowhere else.

```
webview  ──(ready | refresh | signIn)──▶  extension host  ──▶  authentication provider
   ▲                                            │
   └────────(loading | data | signIn | error)───┘ ──▶  <baseUrl>/dashboard/…
```

The host asks `fabric-auth` for a session, puts the bearer on the request, and posts the answer
to the webview as rows of plain strings. The webview has no URL, no header and no credential; its
content security policy is `default-src 'none'` with `connect-src 'none'` stated out loud, its
`localResourceRoots` is pinned to this extension's own `media` directory, and `pack-lint` fails
the build if a webview asset gains a token, a host literal, a request or a navigation.

Shaping the response into rows also happens in the host. That is not tidiness: it is what keeps
the page from ever needing code that walks an unknown object, which is the code that ends up
reaching for `innerHTML`.

## A 401 is an affordance, not a redirect

When the fabric answers 401 the band shows **Sign in to Mew'd**. Pressing it posts a message to
the host, which calls the authentication provider, which opens the operator's browser. No page in
this plank navigates anywhere, ever.

A **403** is treated as a different thing and says so: the fabric knows the session and declined
the route. Signing in again would be theatre.

## Requires

`mewd.fabric-auth`, which registers the `mewd` authentication provider. Without it there is no
session to be had, and every band says so rather than guessing.
