const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { randomUUID } = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execute = promisify(execFile);

function problem(status, message) {
  return Object.assign(new Error(message), { status });
}

function webcam(options = {}) {
  const directory = options.directory || process.env.WEBCAM_DIR || path.join(os.homedir(), "Pictures", "Webcam");
  const device = options.device || process.env.WEBCAM_DEVICE || "/dev/video0";
  const run = options.run || execute;
  const current = path.join(directory, "current.jpg");
  let capturing = false;

  return {
    async image() {
      try {
        return await fs.readFile(current);
      } catch (error) {
        if (error.code === "ENOENT") throw problem(404, "No webcam photo yet. Click Update webcam image to take one.");
        throw error;
      }
    },

    async capture() {
      if (capturing) throw problem(409, "The webcam is taking another photo. Please try again in a moment.");
      capturing = true;
      const temporary = path.join(directory, `.capture-${randomUUID()}.jpg`);
      try {
        await fs.mkdir(directory, { recursive: true });
        try {
          // Same USB-camera capture settings as the archived Pi app; no shell.
          await run("fswebcam", ["-d", device, "-r", "1280x720", "--no-banner", "-S", "2", temporary], {
            timeout: 20000,
            maxBuffer: 1024 * 1024
          });
        } catch (error) {
          if (error.code === "ENOENT") throw problem(503, "The server needs fswebcam installed to take webcam photos.");
          if (error.killed || error.code === "ETIMEDOUT") throw problem(504, "The webcam took too long. Check that it is connected and try again.");
          throw problem(503, "Could not take a webcam photo. Check that the USB webcam is connected, the server has camera permission, and no other app is using it.");
        }

        const image = await fs.readFile(temporary);
        if (image.length < 3 || !image.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) {
          throw problem(503, "The webcam did not return a JPEG photo. Please try again.");
        }

        // Archive only after a successful capture; a failed capture keeps the old photo.
        try {
          await fs.access(current);
          const archive = path.join(directory, "archive");
          await fs.mkdir(archive, { recursive: true });
          const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
          await fs.copyFile(current, path.join(archive, `current-${timestamp}-${randomUUID()}.jpg`));
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        await fs.rename(temporary, current);
        return { url: `/webcam/current.jpg?t=${randomUUID()}` };
      } finally {
        try {
          await fs.rm(temporary, { force: true });
        } finally {
          capturing = false;
        }
      }
    }
  };
}

module.exports = { webcam };
