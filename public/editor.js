"use strict";

const slug = location.pathname === "/" ? "index" : location.pathname.slice(1);
const endpoint = `/api/pages/${encodeURIComponent(slug)}`;
const editor = document.getElementById("page-editor");
const preview = document.getElementById("page-preview");
const source = document.getElementById("page-source");
const status = document.getElementById("update-status");
const showAll = document.getElementById("show-all-code");
const password = document.getElementById("edit-password");
const fileInput = document.getElementById("image-file");
const controls = editor.querySelectorAll("button, #show-all-code, #page-source");
const stateKey = `thinkpad-editor:${slug}`;

let draft = "";
let starter = "";
let fullView = false;
let busy = true;
let dirty = false;
let sizeObserver;

function setBusy(value) {
  busy = value;
  controls.forEach(control => { control.disabled = value; });
  editor.setAttribute("aria-busy", String(value));
}

function parse(html) {
  return new DOMParser().parseFromString(html, "text/html");
}

function serialize(doc) {
  return "<!doctype html>\n" + doc.documentElement.outerHTML
    .replace(/(<html\b[^>]*>)\s*<head/i, "$1\n<head")
    .replace(/<\/head>\s*<body/i, "</head>\n\n<body")
    .replace(/<\/body>\s*<\/html>$/i, "</body>\n</html>\n");
}

function simplified(html) {
  const doc = parse(html);
  doc.querySelectorAll("script").forEach(node => node.remove());
  const styles = [...doc.head.querySelectorAll("style")]
    .map(node => node.outerHTML)
    .join("\n\n");
  return styles + "\n\n<body>\n" + doc.body.innerHTML.replace(/^\n/, "").trimEnd() + "\n</body>\n";
}

function captureEdits() {
  if (fullView) {
    draft = source.value;
    return;
  }

  const doc = parse(draft);
  const edited = parse(source.value);
  const scripts = [...doc.body.querySelectorAll("script")];
  doc.head.querySelectorAll("style").forEach(node => node.remove());
  doc.head.append(...edited.head.querySelectorAll("style"));
  doc.body.replaceChildren(...edited.body.childNodes);
  doc.body.append(...scripts);
  draft = serialize(doc);
}

function renderSource() {
  source.value = fullView ? draft : simplified(draft);
}

function passwordHeaders() {
  return { "X-Edit-Password": password.value };
}

// Storage is only for the editor's display preferences, never page content.
function rememberEditor() {
  try {
    sessionStorage.setItem(stateKey, JSON.stringify({ open: editor.open, fullView }));
  } catch { /* Saving a page still works if browser storage is unavailable. */ }
}

function restoreEditor() {
  try {
    const state = JSON.parse(sessionStorage.getItem(stateKey) || "null");
    if (state) {
      editor.open = Boolean(state.open);
      fullView = Boolean(state.fullView);
      showAll.checked = fullView;
    }
  } catch { /* Use the default collapsed, simple view. */ }
}

function insertElement(html, markup) {
  const body = /<body\b[^>]*>/i.exec(html);
  if (!body) throw new Error("Add an opening <body> tag before inserting an element.");
  const position = body.index + body[0].length;
  return html.slice(0, position) + "\n" + markup + "\n\n"
    + html.slice(position).replace(/^\s*\n/, "");
}

function addElement(markup) {
  source.value = insertElement(source.value, markup);
  dirty = true;
  const body = /<body\b[^>]*>/i.exec(source.value);
  const start = body.index + body[0].length + 1;
  source.focus();
  source.setSelectionRange(start, start + markup.length);
  source.scrollTop = 0;
}

const elements = {
  paragraph: '  <p>Write your paragraph here.</p>',
  title: '  <h1>Your title here</h1>',
  list: '  <ul>\n    <li>First item</li>\n    <li>Second item</li>\n  </ul>',
  link: '  <p><a href="https://example.com">Link text</a></p>'
};

document.querySelectorAll("[data-add]").forEach(button => {
  button.addEventListener("click", () => {
    try {
      addElement(elements[button.dataset.add]);
      status.textContent = "Added to the code. Edit it, then click Update to save.";
    } catch (error) {
      status.textContent = error.message;
    }
  });
});

const modernStyle = `    /* Modern style: make it your own! */
    body {
      font-family: Arial, sans-serif;
      max-width: 800px;
      margin: 40px auto;
      padding: 0 20px;
      background-color: #f4f6fa;
      color: #243047;
      line-height: 1.6;
    }

    h1, h2, a {
      color: #2448a5;
    }

    .intro {
      background-color: white;
      color: #243047;
      padding: 20px;
      border-radius: 12px;
    }

    img {
      max-width: 100%;
      height: auto;
      border-radius: 8px;
    }`;

function addStyle(html) {
  const style = /<style\b[^>]*>([\s\S]*?)<\/style>/i.exec(html);
  if (style) {
    if (style[1].includes("/* Modern style: make it your own! */")) return html;
    const updated = style[0].replace(/\s*<\/style>$/i, "\n\n" + modernStyle + "\n  </style>");
    return html.slice(0, style.index) + updated + html.slice(style.index + style[0].length);
  }
  const position = html.search(/<\/head>|<body\b/i);
  if (position < 0) throw new Error("Add an opening <body> tag before adding styles.");
  return html.slice(0, position) + "<style>\n" + modernStyle + "\n</style>\n\n" + html.slice(position);
}

document.getElementById("add-style").addEventListener("click", () => {
  try {
    const updated = addStyle(source.value);
    const alreadyAdded = updated === source.value;
    if (!alreadyAdded) dirty = true;
    source.value = updated;
    source.focus();
    source.setSelectionRange(0, 0);
    source.scrollTop = 0;
    status.textContent = alreadyAdded
      ? "The style preset is already in your code. Change its values to make it your own."
      : "Styles added to your code. Click Update to apply them.";
  } catch (error) {
    status.textContent = error.message;
  }
});

showAll.addEventListener("change", () => {
  captureEdits();
  fullView = showAll.checked;
  renderSource();
  status.textContent = "";
});

async function savePage(reset = false) {
  if (busy) return;
  const previousDraft = draft;
  const previousSource = source.value;
  if (reset) {
    draft = starter;
    renderSource();
  } else {
    captureEdits();
  }

  setBusy(true);
  status.textContent = "Saving…";
  try {
    const response = await fetch(endpoint, {
      method: "PUT",
      headers: { ...passwordHeaders(), "Content-Type": "text/html" },
      body: draft
    });
    if (!response.ok) throw new Error(await response.text());
    rememberEditor();
    location.reload();
  } catch (error) {
    if (reset) {
      draft = previousDraft;
      source.value = previousSource;
    }
    status.textContent = "Could not save: " + error.message;
    setBusy(false);
  }
}

document.getElementById("update-page").addEventListener("click", () => savePage());
document.getElementById("reset-page").addEventListener("click", () => savePage(true));
document.getElementById("upload-image").addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  if (!file || busy) return;
  if (file.size > 5 * 1024 * 1024) {
    status.textContent = "Choose an image smaller than 5 MB.";
    fileInput.value = "";
    return;
  }
  setBusy(true);
  status.textContent = "Uploading image…";
  try {
    const response = await fetch("/api/uploads", {
      method: "POST",
      headers: { ...passwordHeaders(), "Content-Type": file.type || "application/octet-stream" },
      body: file
    });
    if (!response.ok) throw new Error(await response.text());
    const uploaded = await response.json();
    document.getElementById("image-result").hidden = false;
    document.getElementById("image-code").value = uploaded.html;
    addElement("  " + uploaded.html);
    status.textContent = "Image uploaded and added to your code. Describe it in the alt text, then click Update.";
  } catch (error) {
    status.textContent = "Image upload: " + error.message;
  } finally {
    fileInput.value = "";
    setBusy(false);
  }
});

// The sandbox disables student scripts. Same-origin access only lets the
// trusted parent measure the page and handle its links.
preview.addEventListener("load", () => {
  sizeObserver?.disconnect();
  let doc;
  try { doc = preview.contentDocument; } catch { return; }
  if (!doc?.body) return;

  const resize = () => {
    const height = Math.ceil(doc.body.getBoundingClientRect().height
      + parseFloat(getComputedStyle(doc.body).marginTop || 0)
      + parseFloat(getComputedStyle(doc.body).marginBottom || 0));
    const target = Math.min(10000, Math.max(120, height));
    if (Math.abs(preview.clientHeight - target) > 1) preview.height = String(target);
  };
  sizeObserver = new ResizeObserver(resize);
  sizeObserver.observe(doc.body);
  resize();

  doc.addEventListener("click", event => {
    const link = event.target.closest?.("a[href]");
    if (!link) return;
    const address = new URL(link.getAttribute("href"), location.href);
    if (!["http:", "https:"].includes(address.protocol)) {
      event.preventDefault();
      return;
    }
    if (link.getAttribute("href").startsWith("#")) return;
    event.preventDefault();
    location.assign(address.href);
  });
});

async function loadPage() {
  try {
    const response = await fetch(endpoint);
    if (!response.ok) throw new Error(await response.text());
    const page = await response.json();
    draft = page.html;
    starter = page.starter;
    document.title = slug === "index" ? "ThinkPad Club" : `${slug} · ThinkPad Club`;
    document.getElementById("password-area").hidden = !page.passwordRequired;
    document.getElementById("page-info").textContent = page.saved
      ? `You are editing ${location.pathname}. Update saves this page on the server.`
      : `You are editing ${location.pathname}. This page is not saved yet. Click Update to create it.`;
    restoreEditor();
    renderSource();
    preview.src = `${endpoint}/preview`;
    setBusy(false);
  } catch (error) {
    status.textContent = "Could not load this page: " + error.message + " Refresh to try again.";
  }
}

source.addEventListener("input", () => { dirty = true; });

window.addEventListener("beforeunload", event => {
  if (dirty && !busy) {
    event.preventDefault();
    event.returnValue = "";
  }
});

loadPage();
