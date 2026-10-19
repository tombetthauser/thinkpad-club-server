const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const PORT = process.env.PORT || 3000;
const PAGE = path.join(__dirname, "public", "index.html");
const MAX_BYTES = 1024 * 1024;

const server = http.createServer(async (req, res) => {
  function reply(code, text, type = "text/plain; charset=utf-8") {
    res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" });
    res.end(text);
  }
  try {
    if (req.url === "/health" && req.method === "GET") return reply(200, "ok");
    if ((req.url === "/" || req.url === "/index.html") && req.method === "GET") {
      return reply(200, await fs.readFile(PAGE, "utf8"), "text/html; charset=utf-8");
    }
    if (req.url === "/api/page" && req.method === "PUT") {
      // The editor is local: reject writes initiated by another website.
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) {
        return reply(403, "Origin not allowed.");
      }
      if (req.headers["sec-fetch-site"] === "cross-site") return reply(403, "Origin not allowed.");
      if (req.headers["content-type"] !== "text/html") return reply(415, "Expected text/html.");
      const chunks = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > MAX_BYTES) return reply(413, "Page must be under 1 MB.");
        chunks.push(chunk);
      }
      const html = Buffer.concat(chunks).toString("utf8");
      if (!html.trim()) return reply(400, "Page cannot be empty.");
      await fs.writeFile(PAGE + ".tmp", html);
      await fs.rename(PAGE + ".tmp", PAGE);
      return reply(200, "Saved");
    }
    reply(404, "Not found");
  } catch (error) {
    console.error(error);
    if (!res.headersSent) reply(500, "Could not read or save the page.");
  }
});
server.listen(PORT, "127.0.0.1", () => {
  console.log(`ThinkPad Club listening on http://127.0.0.1:${PORT}`);
});
