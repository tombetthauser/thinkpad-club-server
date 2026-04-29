const http = require("http");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const IMAGES_DIR = path.join(PUBLIC_DIR, "images");
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

  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const safePath = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    sendFile(res, filePath);
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`thinkpad-club-server listening on http://127.0.0.1:${PORT}`);
});
