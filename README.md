# ThinkPad Club

Run `node server.js`, then open http://127.0.0.1:3000.
No dependencies or build step are required. Stop with Ctrl+C.

`public/index.html` is the entire page, including inline CSS, JavaScript,
and its own HTML editor. Update saves the editor contents to that file
through the local Node server and reloads the page. Keep the editor markup
and script in your HTML if you want to continue editing from the browser.
The save button requires the server; opening the HTML as a file cannot save.

The server listens only on localhost. This editor is intended for local use.

## Previous project

`archive/thinkpad-club-before-reset-2026-10-19.tar.gz` contains the previous
working tree, including uncommitted files and local data, excluding `.git`
and the archive folder itself. Extract it into a separate folder to inspect
or restore the old project. The archive is not served by the new server.
