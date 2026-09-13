# fabric-auth

The sign-in for the Mew'd fabric, and the only plank in the pack that ever holds a token.

It registers one VS Code `AuthenticationProvider` under the id `mewd`, so everything else in the
pack asks for a bearer the ordinary way:

```ts
const session = await vscode.authentication.getSession('mewd', ['role:constructor'], {
  createIfNone: false,
});
```

and never sees an authorization code, a verifier or a refresh token.

## The flow

Authorization code with PKCE (`S256`), against a **public client** — one client id, issued by
your fabric, pasted into settings.

- **No dynamic client registration.** A client that can register itself can register itself
  again, and the set of clients allowed to ask for a constructor role stops being something
  anybody decided.
- **No client secret.** This runs on your laptop. A secret shipped to a public client is not a
  secret; carrying one would be a claim about the security model rather than a part of it.
- **No vendor identity provider, and no tunnel.** The authorization request goes to your browser
  and the answer comes back to the editor that asked, through the editor's own URI handler at
  `<scheme>://mewd.fabric-auth/callback`.

Access and refresh tokens are written to `SecretStorage`. They are never written anywhere else,
and there is exactly one way to render a session as text — `describeSession` — which does not
include a token, not even a prefix of one.

## The role is the fabric's to give

The plank *asks* for `role:constructor`. What it *holds* is whatever the token response said it
granted, and nothing else. A grant that comes back as `role:consult` does not become a
constructor session by having been requested as one; it is refused, the freshly-issued lineage is
revoked on the way out, and you are told what you were actually given.

A token response that does not say what it granted has granted nothing this plank will claim.
That is the same rule the rest of the pack runs on: a check that cannot read its input reports
unknown, never pass.

## Signing out

Sign-out presents the **refresh** token to the fabric's revocation endpoint, which kills the
family it was issued from. A refresh lineage that survived a sign-out would make the word
meaningless. The local session is then dropped whether or not the fabric could be reached — a
sign-out that needs the network is a sign-out you cannot perform on a train.

## Settings

| Setting | What it is |
|---|---|
| `mewd.fabric.baseUrl` | Origin of your fabric. `https`, or `http` on loopback. |
| `mewd.fabric.clientId` | The public client id your fabric issued for this editor. |

Neither has a default. `argo-pack` is public and carries no host, address or client id of
anyone's; a default here would be either a lie or a leak. Endpoints are discovered from
`/.well-known/oauth-authorization-server` when your fabric publishes it, and fall back to
`/oauth/authorize`, `/oauth/token` and `/oauth/revoke` when it does not.

## Commands

- **Mew'd fabric: Sign in**
- **Mew'd fabric: Sign out (revokes the refresh lineage)**
- **Mew'd fabric: Show log**
