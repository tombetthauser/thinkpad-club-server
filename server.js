const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID, createHash, timingSafeEqual } = require("node:crypto");
const { ROOT, validSlug, starterPage, pageStore } = require("./lib/pages");

const { webcam } = require("./lib/webcam");
const { robot } = require("./lib/robot");

const PAGE_LIMIT = 1024 * 1024;
const IMAGE_LIMIT = 5 * 1024 * 1024;
const PREVIEW_POLICY = [
  "default-src 'none'",
  "script-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src 'self' data:",
  "form-action 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  "sandbox allow-same-origin allow-top-navigation-by-user-activation"
].join("; ");

function fail(status, message) {
  return Object.assign(new Error(message), { status });
}

async function readBody(req, limit) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    bytes += chunk.length;
    if (bytes > limit) {
      req.resume();
      throw fail(413, `Content is too large (limit: ${limit / 1024 / 1024} MB).`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function imageType(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) {
    return { extension: "png", mime: "image/png" };
  }
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
    return { extension: "jpg", mime: "image/jpeg" };
  }
  if (["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))) {
    return { extension: "gif", mime: "image/gif" };
  }
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    return { extension: "webp", mime: "image/webp" };
  }
  return null;
}

function samePassword(actual, expected) {
  const hash = value => createHash("sha256").update(value).digest();
  return timingSafeEqual(hash(actual), hash(expected));
}

function createServer(options = {}) {
  const dataDirectory = options.dataDirectory || process.env.DATA_DIR || path.join(ROOT, "data");
  const editPassword = options.editPassword ?? process.env.EDIT_PASSWORD ?? "";
  const publicOrigin = options.publicOrigin ?? process.env.PUBLIC_ORIGIN ?? "";
  const pages = pageStore(path.join(dataDirectory, "pages"));
  const uploads = path.join(dataDirectory, "uploads");
  const camera = options.webcam || webcam();
  const motors = options.robot || robot({ enabled: process.env.ROBOT_ENABLED === '1' });

  function authorize(req) {
    const origin = req.headers.origin;
    if (origin) {
      let allowed = false;
      try {
        const parsed = new URL(origin);
        allowed = publicOrigin
          ? parsed.origin === publicOrigin
          : ["http:", "https:"].includes(parsed.protocol) && parsed.host === req.headers.host;
      } catch { /* Malformed origins are rejected below. */ }
      if (!allowed) throw fail(403, "Use these controls from the ThinkPad Club page itself.");
    }
    if (req.headers["sec-fetch-site"] && !["same-origin", "none"].includes(req.headers["sec-fetch-site"])) {
      throw fail(403, "Use these controls from the ThinkPad Club page itself.");
    }
    if (editPassword && !samePassword(req.headers["x-edit-password"] || "", editPassword)) {
      throw fail(401, "Enter the class password to save, upload, or update the webcam.");
    }
  }

  const server = http.createServer(async (req, res) => {
    function reply(status, contents, type = "text/plain; charset=utf-8", extra = {}) {
      res.writeHead(status, {
        "Content-Type": type,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        ...extra
      });
      res.end(contents);
    }
    function json(value, status = 200) {
      reply(status, JSON.stringify(value), "application/json; charset=utf-8");
    }

    try {
      // Inspect the original path as well: URL parsing otherwise normalizes ../.
      const rawPath = req.url.split("?")[0];
      let pathname;
      try { pathname = decodeURIComponent(rawPath); } catch { throw fail(400, "Invalid address."); }
      if (pathname.includes("\\") || pathname.split("/").some(part => part === "." || part === "..")) {
        throw fail(404, "Page not found.");
      }
      const method = req.method;

      if (pathname === "/health" && method === "GET") return reply(200, "ok");

      if (pathname === "/reset") {
        if (method !== "GET") return reply(405, "Use GET to reset the homepage.", undefined, { Allow: "GET" });
        authorize(req);
        await pages.save("index", await fs.readFile(path.join(ROOT, "public", "index.html"), "utf8"));
        return reply(303, "Homepage reset.", undefined, { Location: "/" });
      }

      if (pathname.startsWith('/api/robot/')) {
        // Motor controls are password-free; retain cross-origin protections.
        const origin = req.headers.origin;
        if ((origin && origin !== (publicOrigin || `http://${req.headers.host}`)) ||
            (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site']))) {
          throw fail(403, 'Use the robot control page on this server.');
        }
        const action = pathname.slice('/api/robot/'.length);
        if (action === 'status' && method === 'GET') return json(motors.status());
        if (!['forward', 'backward', 'left', 'right', 'stop', 'test-left', 'test-right'].includes(action)) throw fail(404, 'Unknown robot command.');
        if (method !== 'POST') return reply(405, 'Use POST.', undefined, { Allow: 'POST' });
        if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') throw fail(415, 'Send application/json.');
        // Bind the movement lease to this tab.
        const controller = req.headers['x-robot-controller'];
        if (typeof controller !== 'string' || !/^[a-f0-9-]{36}$/.test(controller)) throw fail(400, 'Missing controller ID.');
        let body;
        try { body = JSON.parse((await readBody(req, 1024)).toString('utf8')); }
        catch (error) { throw error.status ? error : fail(400, 'Invalid JSON.'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail(400, 'Send a JSON object.');
        return json(await motors.command(action, body.speed, controller));
      }

      if (pathname === '/robot' && method === 'GET') {
        return reply(200, await fs.readFile(path.join(ROOT, 'public/robot.html')), 'text/html; charset=utf-8', {
          'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; form-action 'none'; base-uri 'none'",
          'X-Frame-Options': 'DENY'
        });
      }

      if (pathname === "/api/webcam/capture") {
        if (method !== "POST") return reply(405, "Use POST to take a webcam photo.", undefined, { Allow: "POST" });
        authorize(req);
        return json(await camera.capture());
      }

      if (pathname === "/webcam/current.jpg" && method === "GET") {
        return reply(200, await camera.image(), "image/jpeg", {
          "Content-Security-Policy": "default-src 'none'; sandbox"
        });
      }

      const assets = {
        "/assets/robot.js": ["robot.js", "text/javascript; charset=utf-8"],
        "/assets/robot.css": ["robot.css", "text/css; charset=utf-8"],
        "/assets/viewer.js": ["viewer.js", "text/javascript; charset=utf-8"],
        "/assets/viewer.css": ["viewer.css", "text/css; charset=utf-8"],
        "/assets/editor.js": ["editor.js", "text/javascript; charset=utf-8"],
        "/assets/editor.css": ["editor.css", "text/css; charset=utf-8"]
      };
      if (assets[pathname] && method === "GET") {
        const [file, type] = assets[pathname];
        return reply(200, await fs.readFile(path.join(ROOT, "public", file)), type);
      }

      const api = /^\/api\/pages\/([a-z0-9-]+)(\/preview)?$/.exec(pathname);
      if (api && validSlug(api[1])) {
        const slug = api[1];
        if (method === "GET") {
          const page = await pages.read(slug);
          if (api[2]) {
            return reply(200, page.html, "text/html; charset=utf-8", {
              "Content-Security-Policy": PREVIEW_POLICY,
              "X-Frame-Options": "SAMEORIGIN"
            });
          }
          return json({ ...page, starter: starterPage(slug), passwordRequired: Boolean(editPassword) });
        }
        if (method === "PUT" && !api[2]) {
          authorize(req);
          if (req.headers["content-type"]?.split(";")[0].trim() !== "text/html") {
            throw fail(415, "Send page content as text/html.");
          }
          const html = (await readBody(req, PAGE_LIMIT)).toString("utf8");
          if (!html.trim()) throw fail(400, "The page cannot be empty. Use Reset for a fresh page.");
          await pages.save(slug, html);
          return json({ saved: true, url: slug === "index" ? "/" : `/${slug}` });
        }
        return reply(405, "Method not allowed.", undefined, { Allow: api[2] ? "GET" : "GET, PUT" });
      }

      if (pathname === "/api/uploads" && method === "POST") {
        authorize(req);
        const bytes = await readBody(req, IMAGE_LIMIT);
        const type = imageType(bytes);
        if (!type) throw fail(415, "Choose a PNG, JPEG, GIF, or WebP image. SVG files are not supported.");
        const filename = `${randomUUID()}.${type.extension}`;
        await fs.mkdir(uploads, { recursive: true });
        await fs.writeFile(path.join(uploads, filename), bytes, { flag: "wx" });
        const url = `/uploads/${filename}`;
        return json({ url, html: `<img src="${url}" alt="Describe your image">` }, 201);
      }

      const upload = /^\/uploads\/([a-f0-9-]{36}\.(png|jpg|gif|webp))$/.exec(pathname);
      if (upload && method === "GET") {
        const mime = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp" }[upload[2]];
        try {
          return reply(200, await fs.readFile(path.join(uploads, upload[1])), mime, {
            "Cache-Control": "public, max-age=31536000, immutable",
            "Content-Security-Policy": "default-src 'none'; sandbox"
          });
        } catch (error) {
          if (error.code === "ENOENT") throw fail(404, "Image not found.");
          throw error;
        }
      }

      if (method === "GET") {
        const edit = /^\/edit\/([a-z0-9-]+)(\/)?$/.exec(pathname);
        if (edit && validSlug(edit[1])) {
          if (edit[2]) return reply(308, "Use this editor address.", undefined, { Location: `/edit/${edit[1]}` });
          return reply(200, await fs.readFile(path.join(ROOT, "public", "editor.html")), "text/html; charset=utf-8", {
            "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
            "X-Frame-Options": "DENY"
          });
        }
        if (["/index", "/index.html"].includes(pathname)) {
          return reply(308, "Go to /", undefined, { Location: "/" });
        }
        const slug = pathname === "/" ? "index" : pathname.replace(/^\//, "").replace(/\/$/, "");
        if (validSlug(slug)) {
          const canonical = slug === "index" ? "/" : `/${slug}`;
          if (pathname !== canonical) return reply(308, "Use this page address.", undefined, { Location: canonical });
          return reply(200, await fs.readFile(path.join(ROOT, "public", "viewer.html")), "text/html; charset=utf-8", {
            "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
            "X-Frame-Options": "DENY"
          });
        }
      }
      reply(404, "Page not found. Use a name like /dannys-page (lowercase letters, numbers, and hyphens).");
    } catch (error) {
      if (!error.status) console.error(error);
      if (!res.headersSent) reply(error.status || 500, error.status ? error.message : "Could not read or save. Please try again.");
    }
  });
  server.on('close', () => motors.close());
  server.stopRobot = () => motors.close();
  return server;
}

if (require.main === module) {
  const port = process.env.PORT || 3000;
  const host = process.env.HOST || "127.0.0.1";
  const server = createServer().listen(port, host, () => {
    console.log(`ThinkPad Club listening on http://${host}:${port}`);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    server.stopRobot();
    server.close();
    server.closeAllConnections();
  });
  // Stop GPIO before Node exits on an unexpected application failure.
  process.on('uncaughtExceptionMonitor', () => server.stopRobot());
  process.on('exit', () => server.stopRobot());
}

module.exports = { createServer };
