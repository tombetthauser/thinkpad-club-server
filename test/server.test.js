const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const { createServer } = require("../server");

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");

async function fixture(t, options = {}) {
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "thinkpad-test-"));
  const server = createServer({ dataDirectory, editPassword: "", publicOrigin: "", ...options });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dataDirectory, { recursive: true, force: true });
  });
  return { base, server, dataDirectory };
}

function put(base, slug, html, headers = {}) {
  return fetch(`${base}/api/pages/${slug}`, {
    method: "PUT",
    headers: { "Content-Type": "text/html", ...headers },
    body: html
  });
}

test("visiting a new page shows a standalone viewer and starter without creating a file", async t => {
  const { base, dataDirectory } = await fixture(t);
  const response = await fetch(`${base}/dannys-page`);
  assert.equal(response.status, 200);
  const shell = await response.text();
  assert.doesNotMatch(shell, /id="page-editor"|id="upload-image"/);
  assert.match(shell, /assets\/viewer.js/);
  assert.match(shell, /sandbox="allow-same-origin"/);
  const page = await (await fetch(`${base}/api/pages/dannys-page`)).json();
  assert.equal(page.saved, false);
  assert.match(page.html, /<h1>Hello, dannys-page!<\/h1>/);
  assert.doesNotMatch(page.html, /page-editor|<script/);
  assert.deepEqual(await fs.readdir(dataDirectory), []);
  assert.equal(await (await fetch(`${base}/health`)).text(), "ok");
});

test("save creates only that page, survives a server restart, and preserves editable source", async t => {
  const { base, server, dataDirectory } = await fixture(t);
  const html = '<!doctype html><html><head><style>h1 { color: red; }</style></head><body><h1>My own page</h1></body></html>';
  assert.equal((await put(base, "dannys-page", html)).status, 200);
  assert.equal(await fs.readFile(path.join(dataDirectory, "pages", "dannys-page.html"), "utf8"), html);
  assert.deepEqual(await fs.readdir(path.join(dataDirectory, "pages")), ["dannys-page.html"]);
  const loaded = await (await fetch(`${base}/api/pages/dannys-page`)).json();
  assert.equal(loaded.html, html);
  assert.equal(loaded.saved, true);
  assert.equal((await (await fetch(`${base}/api/pages/other-page`)).json()).saved, false);
  assert.doesNotMatch(await (await fetch(`${base}/dannys-page`)).text(), /id="page-editor"/);

  await new Promise(resolve => server.close(resolve));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const restarted = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await (await fetch(`${restarted}/api/pages/dannys-page`)).json()).html, html);

  assert.equal((await put(restarted, "index", "<body><h1>New home</h1></body>")).status, 200);
  assert.match((await (await fetch(`${restarted}/api/pages/index`)).json()).html, /New home/);
  assert.equal((await put(restarted, "dannys-page", loaded.starter)).status, 200);
  assert.equal((await (await fetch(`${restarted}/api/pages/dannys-page`)).json()).html, loaded.starter);
});

test("HTML renders with scripts disabled and the trusted editor remains separate", async t => {
  const { base } = await fixture(t);
  const html = '<body><h1>Hi</h1><script>parent.document.body.remove()</script><img src="x" onerror="alert(1)"></body>';
  await put(base, "demo", html);
  const preview = await fetch(`${base}/api/pages/demo/preview`);
  assert.equal(await preview.text(), html);
  assert.match(preview.headers.get("content-security-policy"), /script-src 'none'/);
  assert.match(preview.headers.get("content-security-policy"), /sandbox allow-same-origin/);
  assert.match(preview.headers.get("content-security-policy"), /form-action 'none'/);
  const shell = await (await fetch(`${base}/demo`)).text();
  assert.doesNotMatch(shell, /parent\.document/);
  assert.match(shell, /\/assets\/viewer.js/);
  assert.equal((await fetch(`${base}/assets/editor.js`)).status, 200);
  assert.equal((await fetch(`${base}/assets/editor.css`)).status, 200);
});

test("images upload to unique names, return usable HTML, and can be retrieved", async t => {
  const { base, dataDirectory } = await fixture(t);
  const response = await fetch(`${base}/api/uploads`, { method: "POST", body: PNG });
  assert.equal(response.status, 201);
  const image = await response.json();
  assert.match(image.url, /^\/uploads\/[a-f0-9-]{36}\.png$/);
  assert.equal(image.html, `<img src="${image.url}" alt="Describe your image">`);
  const fetched = await fetch(base + image.url);
  assert.equal(fetched.headers.get("content-type"), "image/png");
  assert.equal(fetched.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(Buffer.from(await fetched.arrayBuffer()), PNG);
  assert.equal((await fs.readdir(path.join(dataDirectory, "uploads"))).length, 1);
  const second = await (await fetch(`${base}/api/uploads`, { method: "POST", body: PNG })).json();
  assert.notEqual(second.url, image.url);
  assert.equal((await fetch(`${base}/api/uploads`, { method: "POST", body: '<svg onload="alert(1)"></svg>' })).status, 415);
  assert.equal((await fetch(`${base}/uploads/00000000-0000-0000-0000-000000000000.png`)).status, 404);
});

test("password protects saves and uploads, while reading pages stays public", async t => {
  const { base } = await fixture(t, { editPassword: "class-secret" });
  assert.equal((await fetch(`${base}/demo`)).status, 200);
  assert.equal((await (await fetch(`${base}/api/pages/demo`)).json()).passwordRequired, true);
  assert.equal((await put(base, "demo", "<body>Hello</body>")).status, 401);
  assert.equal((await put(base, "demo", "<body>Hello</body>", { "X-Edit-Password": "wrong" })).status, 401);
  assert.equal((await fetch(`${base}/api/uploads`, { method: "POST", body: PNG })).status, 401);
  assert.equal((await put(base, "demo", "<body>Hello</body>", { "X-Edit-Password": "class-secret" })).status, 200);
  assert.equal((await fetch(`${base}/api/uploads`, {
    method: "POST", headers: { "X-Edit-Password": "class-secret" }, body: PNG
  })).status, 201);
});

test("cross-site requests are refused; HTTPS reverse-proxy origins work", async t => {
  const { base } = await fixture(t);
  assert.equal((await put(base, "demo", "<body>Hi</body>", { Origin: "https://another-site.example" })).status, 403);
  assert.equal((await put(base, "demo", "<body>Hi</body>", { Origin: base })).status, 200);
  assert.equal((await put(base, "demo", "<body>Hi</body>", { "Sec-Fetch-Site": "cross-site" })).status, 403);
  const proxied = await fixture(t, { publicOrigin: "https://thinkpad.club" });
  assert.equal((await put(proxied.base, "demo", "<body>Hi</body>", { Origin: "https://thinkpad.club" })).status, 200);
  assert.equal((await put(proxied.base, "demo", "<body>Hi</body>", { Origin: proxied.base })).status, 403);
});

test("invalid paths cannot escape storage or create pages for reserved routes", async t => {
  const { base, dataDirectory } = await fixture(t);
  for (const route of ["/api", "/uploads", "/assets", "/two/levels", "/bad_name", "/favicon.ico", "/archive/anything", "/%2e%2e%2fserver.js", "/bad%5cname", "/%zz"]) {
    const response = await fetch(base + route);
    assert.ok([400, 404].includes(response.status), route);
  }
  for (const slug of ["health", "assets", "uploads", "edit", "a".repeat(65), "-bad", "bad--name"]) {
    assert.equal((await put(base, slug, "<body>No</body>")).status, 404);
  }
  const redirect = await fetch(`${base}/demo/`, { redirect: "manual" });
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.get("location"), "/demo");
  assert.equal((await fetch(`${base}/index.html`, { redirect: "manual" })).headers.get("location"), "/");
  assert.equal((await fetch(`${base}/api/page`, { method: "PUT", body: "old editor" })).status, 404);
  assert.deepEqual(await fs.readdir(dataDirectory), []);
});

test("empty pages, wrong content types, oversized pages and uploads are rejected", async t => {
  const { base, dataDirectory } = await fixture(t);
  assert.equal((await put(base, "demo", " ")).status, 400);
  assert.equal((await put(base, "demo", "<body>Hello</body>", { "Content-Type": "application/json" })).status, 415);
  assert.equal((await put(base, "demo", "x".repeat(1024 * 1024 + 1))).status, 413);
  assert.equal((await fetch(`${base}/api/uploads`, { method: "POST", body: Buffer.alloc(5 * 1024 * 1024 + 1) })).status, 413);
  assert.deepEqual(await fs.readdir(dataDirectory), []);
});

test("webcam routes serve uncached images and protect capture with password and origin checks", async t => {
  let captures = 0;
  const camera = {
    async image() { return Buffer.from([255, 216, 255]); },
    async capture() { captures++; return { url: "/webcam/current.jpg?t=new" }; }
  };
  const { base } = await fixture(t, { editPassword: "class-secret", webcam: camera });
  const image = await fetch(`${base}/webcam/current.jpg?t=old`);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("content-type"), "image/jpeg");
  assert.equal(image.headers.get("cache-control"), "no-store");
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), Buffer.from([255, 216, 255]));
  assert.equal(captures, 0);
  assert.equal((await fetch(`${base}/api/webcam/capture`)).status, 405);
  const capture = headers => fetch(`${base}/api/webcam/capture`, { method: "POST", headers });
  assert.equal((await capture({})).status, 401);
  assert.equal((await capture({ "X-Edit-Password": "class-secret", Origin: "https://another.example" })).status, 403);
  assert.equal(captures, 0);
  const saved = await capture({ "X-Edit-Password": "class-secret", Origin: base });
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).url, "/webcam/current.jpg?t=new");
  assert.equal(captures, 1);
  assert.equal((await put(base, "webcam", "<body>Reserved</body>")).status, 404);
});

test("webcam hardware failures return readable errors without crashing the server", async t => {
  const { base } = await fixture(t, { webcam: {
    async image() { throw Object.assign(new Error("No webcam photo yet."), { status: 404 }); },
    async capture() { throw Object.assign(new Error("USB webcam is not connected."), { status: 503 }); }
  } });
  assert.equal((await fetch(`${base}/webcam/current.jpg`)).status, 404);
  const response = await fetch(`${base}/api/webcam/capture`, { method: "POST" });
  assert.equal(response.status, 503);
  assert.match(await response.text(), /not connected/);
  assert.equal((await fetch(`${base}/health`)).status, 200);
});

test("edit routes load the separate editor, including index, without creating pages", async t => {
  const { base, dataDirectory } = await fixture(t);
  for (const slug of ["index", "chocolate-dolphin"]) {
    const response = await fetch(`${base}/edit/${slug}`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /id="page-editor"/);
    assert.match(html, /id="view-page"/);
    assert.match(html, /developer.mozilla.org/);
    assert.match(html, /w3schools.com\/html/);
    assert.doesNotMatch(html, /id="page-preview"/);
    assert.match(html, /id="draft-frame"[^>]*sandbox=""/);
    assert.match(response.headers.get("content-security-policy"), /script-src 'self'/);
  }
  for (const route of ["/edit", "/edit/robot", "/edit/a/b", "/edit/bad_name"]) {
    assert.equal((await fetch(base + route)).status, 404);
  }
  assert.equal((await fetch(`${base}/edit/index/`, { redirect: "manual" })).headers.get("location"), "/edit/index");
  const home = await (await fetch(`${base}/api/pages/index`)).json();
  assert.match(home.html, /max-width: 750px/);
  assert.match(home.html, /<h1>Thinkpad Club<\/h1>/);
  assert.match(home.html, /data-new-page/);
  assert.match(home.html, /data-webcam-update/);
  assert.deepEqual(await fs.readdir(dataDirectory), []);
});
