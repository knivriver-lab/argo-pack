# hello-band

A webview. That is the whole extension.

Run **Hello Band: Show** from the command palette and a panel opens with a static page loaded
out of the extension's own bundle. The page draws four swatches from the editor's theme tokens
and reports which theme kind the host is in.

It exists to prove the plumbing — frame, content-security policy, nonce, `asWebviewUri`, theme
tokens — in something small enough to read in a minute, so the next plank that needs a webview
starts from a working example.

`localResourceRoots` is pinned to this extension's own `media` directory, so the page cannot
reach anything in the open workspace. It keeps no state, makes no network request, and declares
no terminal.

Manifest: [`plank.yaml`](plank.yaml). Part of [argo-pack](https://github.com/knivriver-lab/argo-pack).
