"use strict";

const slug = location.pathname.split("/")[2];
const endpoint = `/api/pages/${encodeURIComponent(slug)}`;
const editor = document.getElementById("page-editor");
const source = document.getElementById("page-source");
const status = document.getElementById("update-status");
const showAll = document.getElementById("show-all-code");
const password = document.getElementById("edit-password");
const fileInput = document.getElementById("image-file");
const controls = editor.querySelectorAll("button, #show-all-code, #page-source");

let draft = "";
let starter = "";
let fullView = true;
let busy = true;
let dirty = false;

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
  link: '  <p><a href="https://example.com">Link text</a></p>',
  webcam: `  <section data-webcam>
    <h2>Live webcam image</h2>
    <img data-webcam-image src="/webcam/current.jpg" alt="Latest photo from the club webcam" width="640" style="max-width: 100%; height: auto;">
    <p><button type="button" data-webcam-update>Update webcam image</button> <span data-webcam-spinner aria-hidden="true"></span></p>
    <p data-webcam-status role="status">Click Update webcam image to take a new photo from the club's webcam.</p>
  </section>`
};

document.querySelectorAll("[data-add]").forEach(button => {
  button.addEventListener("click", () => {
    try {
      addElement(elements[button.dataset.add]);
      status.textContent = "Added to the code. Edit it, then click Save to save.";
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
      : "Styles added to your code. Click Save to apply them.";
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
    dirty = false;
    status.textContent = "Saved. View your page using the link above.";
    setBusy(false);
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
    status.textContent = "Image uploaded and added to your code. Describe it in the alt text, then click Save.";
  } catch (error) {
    status.textContent = "Image upload: " + error.message;
  } finally {
    fileInput.value = "";
    setBusy(false);
  }
});

async function loadPage() {
  try {
    const response = await fetch(endpoint);
    if (!response.ok) throw new Error(await response.text());
    const page = await response.json();
    draft = page.html;
    starter = page.starter;
    document.title = `Edit ${slug} · Thinkpad Club`;
    document.getElementById("password-area").hidden = !page.passwordRequired;
    document.getElementById("page-info").textContent = page.saved
      ? `You are editing /${slug === "index" ? "" : slug}. Save writes this page to the server.`
      : `You are editing /${slug === "index" ? "" : slug}. This page is not saved yet. Click Save to create it.`;
    renderSource();
    document.getElementById("view-page").href = slug === "index" ? "/" : `/${slug}`;
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


// Preview stays in this tab and never sends the draft to the server.
document.getElementById("preview-page").addEventListener("click", () => {
  if (busy) return;
  captureEdits();
  const policy = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'";
  document.getElementById("draft-frame").srcdoc =
    `<meta http-equiv="Content-Security-Policy" content="${policy}">\n` + draft;
  document.getElementById("draft-preview").hidden = false;
  status.textContent = "Preview refreshed. Your changes have not been saved.";
});

document.getElementById("close-preview").addEventListener("click", () => {
  document.getElementById("draft-preview").hidden = true;
});

const scienceSnacks = [
  ["Gravity: the universe wants its sandwich back",
    "Drop a sandwich and it falls toward Earth. Gravity is a pull between things that have mass. Earth has a LOT of mass, so its pull is easy to notice.",
    "The sandwich pulls on Earth too! Earth is so massive that its motion toward your lunch is too tiny to notice. In space, gravity helps keep moons and planets in orbit."],
  ["Fractions: a pizza has entered the chat",
    "Cut a pizza into 8 equal slices. One slice is 1/8 of the pizza. The bottom number tells you how many equal pieces make the whole. The top number counts the pieces you have.",
    "Four of those slices make 4/8 of the pizza. That is the same amount as 1/2. Different fraction names can describe the same amount. Your pizza does not care what you call it."],
  ["Photosynthesis: a leaf's lunch factory",
    "Plants use energy from sunlight to turn water and carbon dioxide into sugars. Those sugars help plants grow. This process is called photosynthesis, and it releases oxygen.",
    "A leaf is not actually eating a sun sandwich. It catches light using a green pigment called chlorophyll. Roots bring in water, and tiny openings in leaves let gases move in and out."],
  ["Prime numbers refuse to share their crackers",
    "A prime number is a whole number greater than 1 with exactly two positive factors: 1 and itself. You can divide 7 evenly by 1 or 7, so 7 is prime.",
    "You can arrange 12 crackers in 3 equal rows of 4. That makes 12 composite, not prime. The number 1 is neither prime nor composite. It has only one positive factor. An exclusive cracker club."],
  ["The water cycle has lost its luggage",
    "Liquid water can gain energy and evaporate into water vapor, a gas. When water vapor cools, it can condense into tiny liquid drops. Clouds contain tiny water drops or ice crystals.",
    "When drops or ice particles grow heavy enough, water falls as precipitation, such as rain or snow. Water collects, soaks into the ground, or flows into rivers. Then the trip continues. No suitcase required."],
  ["Sound: the air is doing a tiny dance",
    "A vibrating object makes nearby particles vibrate. These vibrations can travel as sound waves through air, water, or solids. Your ears detect vibrations and your brain makes sense of them.",
    "Faster vibrations usually mean a higher pitch. Bigger vibrations can make a louder sound. Sound needs matter to travel through, so an empty vacuum is a terrible place for a kazoo concert."]
];

function randomHTML() {
  const pick = values => values[Math.floor(Math.random() * values.length)];
  const [title, first, second] = pick(scienceSnacks);
  const background = pick(["lemonchiffon", "aquamarine", "mistyrose", "lavender", "peachpuff"]);
  const ink = pick(["navy", "darkgreen", "maroon", "indigo"]);
  const border = pick(["dashed", "dotted", "double", "ridge"]);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    /* Questionable design choices. Excellent science snacks. Change anything! */
    body { background: ${background}; color: ${ink}; font-family: ${pick(["'Comic Sans MS', cursive", "Georgia, serif", "monospace"])}; max-width: 650px; margin: 30px auto; padding: 20px; }
    h1 { border: 12px ${border} ${ink}; padding: 18px; text-shadow: 3px 3px hotpink; transform: rotate(${pick([-3, -2, 2, 3])}deg); }
    p { font-size: 20px; line-height: 1.6; }
    .important-business { background: white; border-radius: 40% 5% 30% 2%; padding: 24px; box-shadow: 9px 9px ${ink}; }
    footer { margin-top: 35px; letter-spacing: 3px; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <p>${first}</p>
  <p class="important-business">${second}</p>
  <footer>Official Department of Extremely Serious Noodles</footer>
</body>
</html>
`;
}

document.getElementById("random-html").addEventListener("click", () => {
  if (busy || !window.confirm("This will delete everything in the code editor and replace it with random HTML. Your saved page will only change if you click Save. Continue?")) return;
  draft = randomHTML();
  fullView = true;
  showAll.checked = true;
  renderSource();
  dirty = true;
  document.getElementById("draft-preview").hidden = true;
  source.focus();
  source.scrollTop = 0;
  status.textContent = "Random HTML added. Preview it or change it, then Save when ready.";
});

loadPage();
