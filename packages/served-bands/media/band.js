// The whole of a band webview.
//
// It receives rows and paints them. It has no URL, no header and no credential, and the only
// thing it can reach is the extension host it was opened by — `acquireVsCodeApi` is the single
// bridge, and `postMessage` is the only verb on it.
//
// Two rules hold that shape, and pack-lint fails this file if either is broken: nothing in a
// band webview opens a connection of its own, and nothing in one navigates. Signing in is a
// message to the host, not a link to somewhere. The rules name the APIs; this file does not
// need to, and a webview asset that spelled them out would be arguing with its own lint.
//
// Everything is written with `textContent`. A band renders what the fabric said, and what the
// fabric said is data.

(function () {
  'use strict';

  const vscode = acquireVsCodeApi();

  const elements = {
    state: document.getElementById('state'),
    rows: document.getElementById('rows'),
    blurb: document.getElementById('blurb'),
    stamp: document.getElementById('stamp'),
    refresh: document.getElementById('refresh'),
    signin: document.getElementById('signin'),
    signinReason: document.getElementById('signin-reason'),
    signinButton: document.getElementById('signin-button'),
  };

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function line(className, text) {
    const span = document.createElement('span');
    span.className = className;
    span.textContent = text;
    return span;
  }

  function paintRows(rows) {
    clear(elements.rows);
    for (const row of rows) {
      const item = document.createElement('li');
      item.appendChild(line('row-title', String(row.title)));
      if (row.badge) item.appendChild(line('row-badge', String(row.badge)));
      if (row.detail) item.appendChild(line('row-detail', String(row.detail)));
      elements.rows.appendChild(item);
    }
  }

  function show(options) {
    elements.state.textContent = options.state;
    elements.state.hidden = options.state === '';
    elements.signin.hidden = !options.signIn;
    elements.refresh.hidden = !options.refresh;
    elements.stamp.textContent = options.stamp || '';
    if (!options.keepRows) clear(elements.rows);
  }

  function render(message) {
    switch (message.type) {
      case 'loading':
        show({ state: 'Asking the fabric…', refresh: false, signIn: false, keepRows: true });
        break;

      case 'data':
        paintRows(message.rows || []);
        show({
          state: (message.rows || []).length === 0 ? 'Nothing here.' : '',
          refresh: true,
          signIn: false,
          keepRows: true,
          stamp: 'as of ' + message.at,
        });
        break;

      case 'signIn':
        show({ state: '', refresh: false, signIn: true });
        elements.signinReason.textContent = message.reason || '';
        break;

      case 'unconfigured':
        show({ state: message.reason, refresh: false, signIn: false });
        break;

      case 'error':
        show({ state: message.message, refresh: true, signIn: false });
        break;

      default:
        break;
    }
  }

  window.addEventListener('message', function (event) {
    if (event.data && typeof event.data.type === 'string') render(event.data);
  });

  elements.refresh.addEventListener('click', function () {
    vscode.postMessage({ type: 'refresh' });
  });

  // Not a link, and not a redirect. The host owns the sign-in; this button only asks for one.
  elements.signinButton.addEventListener('click', function () {
    vscode.postMessage({ type: 'signIn' });
  });

  vscode.postMessage({ type: 'ready' });
})();
