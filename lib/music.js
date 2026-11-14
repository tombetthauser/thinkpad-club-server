const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { videoURL } = require("./youtube");

const LIMIT = 50 * 1024 * 1024;
const problem = (status, message) => Object.assign(new Error(message), { status });

function music({ directory, spawn: start = spawn, timeoutMs = 180000 } = {}) {
  let busy = false;
  return {
    async download(input) {
      const url = videoURL(input);
      if (busy) throw problem(409, "Another music import is in progress. Try again shortly.");
      busy = true;
      const id = randomUUID();
      const temporary = path.join(directory, `.music-${id}`);
      let child;
      let timer;
      let sizeTimer;
      let failure;
      let forceTimer;
      let running = false;
      function stop(error) {
        if (failure || !running) return;
        failure = error;
        if (!child) return;
        const kill = signal => {
          try {
            if (child.pid && process.platform !== "win32") process.kill(-child.pid, signal);
            else child.kill(signal);
          } catch (error) {
            if (error.code !== "ESRCH") console.warn("Could not stop music import:", error.message);
          }
        };
        kill("SIGTERM");
        forceTimer = setTimeout(() => kill("SIGKILL"), 1000);
        forceTimer.unref();
      }
      try {
        await fs.mkdir(temporary, { recursive: true });
        const args = ["--ignore-config", "--no-playlist", "--no-cache-dir", "--no-progress",
          "--js-runtimes", `node:${process.execPath}`, "--socket-timeout", "15", "--retries", "1",
          "--match-filter", "duration > 0 & duration <= 600", "--max-filesize", String(LIMIT),
          "-f", "bestaudio[protocol=https]/best[protocol=https]", "-x", "--audio-format", "mp3",
          "-o", path.join(temporary, "track.%(ext)s"), "--", url];
        await new Promise((resolve, reject) => {
          child = start(process.env.YTDLP_BIN || "yt-dlp", args, { stdio: ["ignore", "ignore", "pipe"], detached: process.platform !== "win32" });
          running = true;
          child.stderr.on("data", data => console.warn(`Music import: ${data.toString().trim().slice(0, 2000)}`));
          child.once("error", error => { running = false; reject(problem(503, `Could not start yt-dlp: ${error.message}`)); });
          child.once("close", code => {
            running = false;
            if (failure) reject(failure);
            else if (code !== 0) reject(problem(422, "Could not import this video. Check the URL and server logs."));
            else resolve();
          });
          timer = setTimeout(() => stop(problem(504, "Music import took too long.")), timeoutMs);
          timer.unref();
          sizeTimer = setInterval(async () => {
            try {
              const names = await fs.readdir(temporary);
              let size = 0;
              for (const name of names) {
                try { size += (await fs.stat(path.join(temporary, name))).size; }
                catch (error) { if (error.code !== "ENOENT") throw error; }
              }
              if (size > LIMIT * 2) stop(problem(413, "Music import exceeds the size limit."));
            } catch (error) {
              stop(problem(500, `Could not monitor music import: ${error.message}`));
            }
          }, 500);
          sizeTimer.unref();
        });
        const file = path.join(temporary, "track.mp3");
        let info;
        try { info = await fs.stat(file); }
        catch (error) {
          if (error.code === "ENOENT") throw problem(422, "No audio was imported. Use a video under 10 minutes with audio.");
          throw error;
        }
        if (!info.size || info.size > LIMIT) throw problem(413, "Imported audio must be between 1 byte and 50 MB.");
        await fs.rename(file, path.join(directory, `${id}.mp3`));
        return { url: `/uploads/${id}.mp3` };
      } finally {
        clearTimeout(timer);
        clearTimeout(forceTimer);
        clearInterval(sizeTimer);
        try { await fs.rm(temporary, { recursive: true, force: true }); }
        finally { busy = false; }
      }
    }
  };
}

module.exports = { music, LIMIT };
