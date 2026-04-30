const http = require("http");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const IMAGES_DIR = path.join(PUBLIC_DIR, "images");
const DATA_GAMES_DIR = path.join(__dirname, "data", "games");
const GAMES_POST_MAX_BYTES = 8192;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const DEPLOY_COMMAND = process.env.DEPLOY_COMMAND || "/usr/local/bin/deploy-thinkpad-server.sh";
const DEPLOY_TIMEOUT_MS = 120000;
let deployInProgress = false;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
};

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME_TYPES[ext] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": type });
  fs.createReadStream(filePath).pipe(res);
}

function sanitizeBaseName(name) {
  return name.toLowerCase().replace(/[^a-z0-9-_]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function parseImageDataUrl(dataUrl) {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(dataUrl || "");
  if (!match) return null;
  return {
    mimeType: match[1].toLowerCase(),
    base64Data: match[2].replace(/\s/g, ""),
  };
}

function extensionForMimeType(mimeType) {
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/gif") return ".gif";
  if (mimeType === "image/webp") return ".webp";
  return null;
}

/** --- Scratch games: one JSON file per user (simple NoSQL-style store) --- */

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseScratchProjectUrl(urlString) {
  if (!urlString || typeof urlString !== "string") return null;
  let raw = urlString.trim();
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (!/^scratch\.mit\.edu$/i.test(u.hostname)) return null;
  const m = /^\/projects\/(\d+)\/?$/i.exec(u.pathname);
  if (!m) return null;
  return { projectId: m[1] };
}

function readGames(userSlug, callback) {
  const filePath = path.join(DATA_GAMES_DIR, `${userSlug}.json`);
  fs.readFile(filePath, "utf8", (err, data) => {
    if (err && err.code === "ENOENT") {
      callback(null, []);
      return;
    }
    if (err) {
      callback(err);
      return;
    }
    try {
      const parsed = JSON.parse(data);
      const games = Array.isArray(parsed.games) ? parsed.games : [];
      callback(null, games);
    } catch {
      callback(new Error("Invalid games file"));
    }
  });
}

function writeGames(userSlug, games, callback) {
  fs.mkdir(DATA_GAMES_DIR, { recursive: true }, (mkdirErr) => {
    if (mkdirErr) {
      callback(mkdirErr);
      return;
    }
    const filePath = path.join(DATA_GAMES_DIR, `${userSlug}.json`);
    fs.writeFile(filePath, JSON.stringify({ games }, null, 2), "utf8", callback);
  });
}

function renderGamesPage(userSlug, games, flash) {
  const displayName = escapeHtml(userSlug);
  const formAction = `/${userSlug}/games`;
  let banner = "";
  if (flash === "invalid") {
    banner =
      '<p class="flash"><strong>That link is not a Scratch project page.</strong> Use something like <code>https://scratch.mit.edu/projects/123456789</code> (from Share → Copy link).</p>';
  } else if (flash === "exists") {
    banner = '<p class="flash"><strong>That project is already in your list.</strong></p>';
  }

  let listHtml = "";
  games.forEach((g, index) => {
    const pid = escapeHtml(g.projectId);
    const embed = `https://scratch.mit.edu/projects/${g.projectId}/embed`;
    listHtml += `<section class="game-block">
  <h2>Game ${index + 1} — project #${pid}</h2>
  <iframe title="Scratch project ${pid}" src="${embed}" width="485" height="402" allowtransparency="true" frameborder="0" scrolling="no" allowfullscreen></iframe>
</section>\n`;
  });
  if (games.length === 0) {
    listHtml = "<p>No games yet. Add a Scratch link above!</p>";
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${displayName}'s Scratch games</title>
  <style>
    body { font-family: "Comic Sans MS", "Comic Sans", cursive, sans-serif; max-width: 640px; margin: 24px auto; padding: 0 16px; }
    h1 { font-size: 1.5rem; }
    .add-form { border: 2px dashed #6ec4e8; padding: 16px; border-radius: 12px; margin-bottom: 28px; background: #fafcff; }
    label { display: block; margin-bottom: 8px; font-weight: bold; }
    input[type="url"] { width: 100%; max-width: 100%; padding: 8px; font: inherit; box-sizing: border-box; border: 2px solid #333; border-radius: 6px; }
    button { margin-top: 12px; font: inherit; padding: 8px 16px; cursor: pointer; border: 2px solid #333; border-radius: 8px; background: #e8f7fc; }
    .game-block { margin-bottom: 36px; }
    .game-block iframe { display: block; max-width: 100%; border: 2px solid #ccc; border-radius: 8px; }
    a { color: #2563c7; }
    .flash { background: #fff3cd; border: 1px solid #e0c400; padding: 10px 12px; border-radius: 8px; }
  </style>
</head>
<body>
  <p><a href="/">← Home</a> · <a href="/${userSlug}">Your page</a> (${displayName})</p>
  <h1>${displayName}'s Scratch games</h1>
  ${banner}
  <form class="add-form" method="post" action="${formAction}">
    <label for="scratchUrl">Paste a Scratch project link</label>
    <input id="scratchUrl" name="scratchUrl" type="url" autocomplete="off" placeholder="https://scratch.mit.edu/projects/..." required />
    <div><button type="submit">Add game</button></div>
  </form>
  ${listHtml}
</body>
</html>`;
}

function handleGamesGet(res, userSlug, searchParams) {
  const flash =
    searchParams.get("error") === "invalid"
      ? "invalid"
      : searchParams.get("msg") === "exists"
        ? "exists"
        : null;
  readGames(userSlug, (err, games) => {
    if (err) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Could not load games.");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderGamesPage(userSlug, games, flash));
  });
}

function handleGamesPost(req, res, userSlug) {
  let rawBody = "";
  req.on("data", (chunk) => {
    rawBody += chunk;
    if (Buffer.byteLength(rawBody, "utf8") > GAMES_POST_MAX_BYTES) {
      res.writeHead(413, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Form too large.");
      req.destroy();
    }
  });
  req.on("end", () => {
    let params;
    try {
      params = new URLSearchParams(rawBody);
    } catch {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Bad form data.");
      return;
    }
    const scratchUrl = String(params.get("scratchUrl") || "").trim();
    const parsed = parseScratchProjectUrl(scratchUrl);
    if (!parsed) {
      res.writeHead(303, { Location: `/${userSlug}/games?error=invalid` });
      res.end();
      return;
    }
    readGames(userSlug, (readErr, games) => {
      if (readErr) {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Could not read games.");
        return;
      }
      if (games.some((g) => g.projectId === parsed.projectId)) {
        res.writeHead(303, { Location: `/${userSlug}/games?msg=exists` });
        res.end();
        return;
      }
      games.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        projectId: parsed.projectId,
        addedAt: new Date().toISOString(),
      });
      writeGames(userSlug, games, (writeErr) => {
        if (writeErr) {
          res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Could not save.");
          return;
        }
        res.writeHead(303, { Location: `/${userSlug}/games` });
        res.end();
      });
    });
  });
  req.on("error", () => {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Request error.");
  });
}

const server = http.createServer((req, res) => {
  const requestedUrl = new URL(req.url, "http://127.0.0.1");
  const pathname = requestedUrl.pathname;

  if (req.method === "POST" && pathname === "/upload-image") {
    let rawBody = "";

    req.on("data", (chunk) => {
      rawBody += chunk;
      if (Buffer.byteLength(rawBody, "utf8") > MAX_UPLOAD_BYTES) {
        res.writeHead(413, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Upload too large (max 10MB)." }));
        req.destroy();
      }
    });

    req.on("end", () => {
      let payload;
      try {
        payload = JSON.parse(rawBody);
      } catch {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Invalid JSON body." }));
        return;
      }

      const parsedImage = parseImageDataUrl(payload?.dataUrl);
      if (!parsedImage) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Only pasted or dropped images are supported." }));
        return;
      }

      const extension = extensionForMimeType(parsedImage.mimeType);
      if (!extension) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Image type not supported. Use PNG, JPG, GIF, or WEBP." }));
        return;
      }

      const userName = String(payload?.fileName || "").trim();
      const cleanBase = sanitizeBaseName(userName) || "my-image";
      const finalFileName = cleanBase.endsWith(extension) ? cleanBase : `${cleanBase}${extension}`;
      const destination = path.join(IMAGES_DIR, finalFileName);

      if (!destination.startsWith(IMAGES_DIR)) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Invalid file name." }));
        return;
      }

      const imageBuffer = Buffer.from(parsedImage.base64Data, "base64");
      fs.mkdir(IMAGES_DIR, { recursive: true }, (mkdirErr) => {
        if (mkdirErr) {
          res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "Could not create images folder." }));
          return;
        }

        fs.writeFile(destination, imageBuffer, (writeErr) => {
          if (writeErr) {
            res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ error: "Could not save image." }));
            return;
          }

          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ fileName: finalFileName }));
        });
      });
    });

    req.on("error", () => {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Upload failed." }));
    });

    return;
  }

  if (req.method === "POST" && pathname === "/admin/deploy") {
    if (deployInProgress) {
      res.writeHead(409, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Deploy already in progress." }));
      return;
    }

    deployInProgress = true;
    exec(
      DEPLOY_COMMAND,
      { timeout: DEPLOY_TIMEOUT_MS },
      (error, stdout, stderr) => {
        deployInProgress = false;

        if (error) {
          res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          res.end(
            JSON.stringify({
              ok: false,
              error: "Deploy command failed.",
              details: stderr || stdout || error.message,
            }),
          );
          return;
        }

        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(
          JSON.stringify({
            ok: true,
            output: stdout.trim(),
          }),
        );
      },
    );
    return;
  }

  if (pathname === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("ok");
    return;
  }

  const normalizedPath = pathname.replace(/\/+$/, "") || "/";
  const gamesMatch = /^\/([a-z0-9_-]+)\/games$/i.exec(normalizedPath);
  if (gamesMatch) {
    const userSlug = gamesMatch[1].toLowerCase();
    if (req.method === "GET") {
      handleGamesGet(res, userSlug, requestedUrl.searchParams);
      return;
    }
    if (req.method === "POST") {
      handleGamesPost(req, res, userSlug);
      return;
    }
    res.writeHead(405, { Allow: "GET, POST", "Content-Type": "text/plain; charset=utf-8" });
    res.end("Method not allowed");
    return;
  }

  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const safePath = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  function trySendOr404(candidatePath) {
    fs.stat(candidatePath, (err, stats) => {
      if (err || !stats.isFile()) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Not found");
        return;
      }
      sendFile(res, candidatePath);
    });
  }

  fs.stat(filePath, (err, stats) => {
    if (!err && stats.isFile()) {
      sendFile(res, filePath);
      return;
    }
    // e.g. /chase → public/chase.html when public/chase does not exist
    if (!path.extname(safePath)) {
      trySendOr404(filePath + ".html");
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`thinkpad-club-server listening on http://127.0.0.1:${PORT}`);
});
