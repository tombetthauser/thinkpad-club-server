const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const ROOT = path.join(__dirname, "..");
const RESERVED = new Set(["api", "assets", "uploads", "health"]);

function validSlug(slug) {
  return slug.length <= 64 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && !RESERVED.has(slug);
}

function starterPage(slug) {
  const name = slug === "index" ? "ThinkPad Club" : slug;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${name}</title>

  <style>
    /* Add your CSS here. */
  </style>
</head>

<body>
  <h1>Hello, ${name}!</h1>

  <p>
    This is your page! Open Edit this page below to change the words or add
    something new. Click Update to save your work. Come back to this same
    address to see it again.
  </p>
</body>
</html>
`;
}

// A unique temporary file keeps readers from seeing a partly written page.
async function atomicWrite(filename, contents) {
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, contents, { flag: "wx" });
    await fs.rename(temporary, filename);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

function pageStore(directory) {
  return {
    async read(slug) {
      try {
        return { html: await fs.readFile(path.join(directory, `${slug}.html`), "utf8"), saved: true };
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        const html = slug === "index"
          ? await fs.readFile(path.join(ROOT, "public", "index.html"), "utf8")
          : starterPage(slug);
        return { html, saved: false };
      }
    },

    async save(slug, html) {
      await atomicWrite(path.join(directory, `${slug}.html`), html);
    }
  };
}

module.exports = { ROOT, validSlug, starterPage, atomicWrite, pageStore };
