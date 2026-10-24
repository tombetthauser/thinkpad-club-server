const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const vm = require("node:vm");

// Test browser-side save/upload handlers without adding a browser dependency.
// These tests exercise full-code mode; real layout and DOM parsing need a browser.
async function editorFixture({ failSave = false, failCapture = false, confirmRandom = false } = {}) {
  function element() {
    return {
      value: "", disabled: false, hidden: false, open: false,
      dataset: {}, listeners: {},
      addEventListener(type, handler) { this.listeners[type] = handler; },
      setAttribute() {}, focus() {}, setSelectionRange() {}, click() {}
    };
  }
  const ids = ["page-editor", "view-page", "page-source", "update-status", "show-all-code",
    "edit-password", "image-file", "add-style", "update-page", "reset-page", "upload-image",
    "image-result", "image-code", "password-area", "page-info", "preview-page", "random-html", "close-preview", "draft-frame", "draft-preview"];
  const nodes = Object.fromEntries(ids.map(id => [id, element()]));
  const addButtons = ["paragraph", "title", "list", "link", "webcam"].map(kind => ({ ...element(), dataset: { add: kind } }));
  const controls = [nodes["update-page"], nodes["reset-page"], nodes["page-source"], nodes["show-all-code"], ...addButtons];
  nodes["page-editor"].querySelectorAll = () => controls;
  const html = '<!doctype html>\n<html><head><style>p { color: red; }</style></head><body>\n  <p>Existing work</p>\n</body></html>';
  const starter = '<!doctype html><html><head></head><body><h1>Hello, dannys-page!</h1></body></html>';
  const requests = [];
  const storage = new Map([["thinkpad-editor:dannys-page", JSON.stringify({ open: true, fullView: true })]]);
  let reloads = 0;
  const context = vm.createContext({
    URL,
    location: { pathname: "/edit/dannys-page", href: "http://localhost/edit/dannys-page", reload() { reloads++; } },
    document: { getElementById: id => nodes[id], querySelectorAll: () => addButtons },
    window: { addEventListener() {}, confirm: () => confirmRandom },
    sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    fetch: async (url, options = {}) => {
      requests.push({ url, ...options });
      if (options.method === "PUT") return { ok: !failSave, text: async () => "Password required" };
      if (url === "/api/webcam/capture") return {
        ok: !failCapture,
        text: async () => "USB webcam is not connected.",
        json: async () => ({ url: "/webcam/current.jpg?t=new" })
      };
      if (options.method === "POST") return { ok: true, json: async () => ({ html: '<img src="/uploads/example.png" alt="Describe your image">' }) };
      return { ok: true, json: async () => ({ html, starter, saved: true, passwordRequired: true }) };
    }
  });
  const script = await fs.readFile(path.join(__dirname, "..", "public", "editor.js"), "utf8");
  vm.runInContext(script.replace(/loadPage\(\);\s*$/, "globalThis.ready = loadPage();"), context);
  await context.ready;
  return { context, nodes, addButtons, requests, storage, html, starter, reloads: () => reloads };
}

test("Add buttons preserve full source and Save sends changes with the class password", async () => {
  const f = await editorFixture();
  const source = f.nodes["page-source"];
  await f.addButtons[0].listeners.click();
  assert.match(source.value, /<body>\n  <p>Write your paragraph here\.<\/p>/);
  assert.match(source.value, /Existing work/);
  await f.nodes["add-style"].listeners.click();
  const styled = source.value;
  await f.nodes["add-style"].listeners.click();
  assert.equal(source.value, styled);
  assert.match(source.value, /font-family: Arial/);
  f.nodes["edit-password"].value = "class-secret";
  await f.nodes["update-page"].listeners.click();
  const save = f.requests.find(request => request.method === "PUT");
  assert.equal(save.url, "/api/pages/dannys-page");
  assert.equal(save.body, source.value);
  assert.equal(save.headers["X-Edit-Password"], "class-secret");
  assert.equal(f.reloads(), 0);
  assert.match(f.nodes["update-status"].textContent, /Saved/);
  assert.equal(f.nodes["view-page"].href, "/dannys-page");
});

test("Reset saves the starter without leaving the editor", async () => {
  const f = await editorFixture();
  await f.nodes["reset-page"].listeners.click();
  assert.equal(f.requests.find(request => request.method === "PUT").body, f.starter);
  assert.equal(f.reloads(), 0);
  assert.match(f.nodes["update-status"].textContent, /Saved/);
});

test("Upload inserts usable image HTML but does not save the page until Update", async () => {
  const f = await editorFixture();
  const image = { size: 50, type: "image/png" };
  f.nodes["image-file"].files = [image];
  await f.nodes["image-file"].listeners.change();
  assert.equal(f.requests.find(request => request.method === "POST").body, image);
  assert.match(f.nodes["page-source"].value, /<body>\n  <img src="\/uploads\/example.png"/);
  assert.match(f.nodes["image-code"].value, /alt="Describe your image"/);
  assert.equal(f.nodes["image-result"].hidden, false);
  assert.equal(f.requests.some(request => request.method === "PUT"), false);
  await f.nodes["update-page"].listeners.click();
  assert.match(f.requests.find(request => request.method === "PUT").body, /\/uploads\/example.png/);
});

test("failed Reset restores unsaved work and leaves the controls usable", async () => {
  const f = await editorFixture({ failSave: true });
  const unsaved = f.html.replace("Existing work", "My unsaved changes");
  f.nodes["page-source"].value = unsaved;
  await f.nodes["reset-page"].listeners.click();
  assert.equal(f.nodes["page-source"].value, unsaved);
  assert.equal(f.nodes["update-page"].disabled, false);
  assert.equal(f.nodes["reset-page"].disabled, false);
  assert.equal(f.reloads(), 0);
  assert.match(f.nodes["update-status"].textContent, /Could not save: Password required/);
});


test("Add webcam inserts a persistent image and update button without student JavaScript", async () => {
  const f = await editorFixture();
  await f.addButtons.find(button => button.dataset.add === "webcam").listeners.click();
  assert.match(f.nodes["page-source"].value, /<body>\n  <section data-webcam>/);
  assert.match(f.nodes["page-source"].value, /src="\/webcam\/current.jpg"/);
  assert.match(f.nodes["page-source"].value, /data-webcam-update>Update webcam image/);
  assert.doesNotMatch(f.nodes["page-source"].value, /<script|onclick=/);
  await f.nodes["update-page"].listeners.click();
  assert.match(f.requests.find(request => request.method === "PUT").body, /data-webcam/);
});

test("random HTML requires confirmation and replaces only the draft until Save", async () => {
  const cancelled = await editorFixture();
  await cancelled.nodes["random-html"].listeners.click();
  assert.equal(cancelled.nodes["page-source"].value, cancelled.html);
  assert.equal(cancelled.requests.length, 1);
  const f = await editorFixture({ confirmRandom: true });
  await f.nodes["random-html"].listeners.click();
  const generated = f.nodes["page-source"].value;
  assert.match(generated, /<!doctype html>/);
  assert.match(generated, /<style>/);
  assert.match(generated, /Department of Extremely Serious Noodles/);
  assert.notEqual(generated, f.html);
  assert.equal(f.requests.length, 1);
  await f.nodes["update-page"].listeners.click();
  assert.equal(f.requests.find(request => request.method === "PUT").body, generated);
});

test("preview uses current unsaved code, refreshes on demand, and never saves", async () => {
  const f = await editorFixture();
  const draft = '<h1>Unsaved jellyfish</h1><script>alert(1)</script>';
  f.nodes["page-source"].value = draft;
  await f.nodes["preview-page"].listeners.click();
  assert.equal(f.nodes["draft-preview"].hidden, false);
  assert.match(f.nodes["draft-frame"].srcdoc, /default-src 'none'/);
  assert.ok(f.nodes["draft-frame"].srcdoc.endsWith(draft));
  assert.equal(f.requests.length, 1);
  await f.nodes["close-preview"].listeners.click();
  assert.equal(f.nodes["draft-preview"].hidden, true);
  f.nodes["page-source"].value = '<h1>Another draft</h1>';
  await f.nodes["preview-page"].listeners.click();
  assert.match(f.nodes["draft-frame"].srcdoc, /Another draft/);
  assert.equal(f.requests.length, 1);
});
