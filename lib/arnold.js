const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

function arnold(options = {}) {
  const directory = options.directory || path.join(__dirname, "..", "assets", "audio", "arnold-realm");
  const device = options.device || process.env.ARNOLD_SOUND_DEVICE || process.env.WEBCAM_SOUND_DEVICE;
  const start = options.spawn || spawn;
  let current = null;

  function clips() {
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"), "utf8"));
    return manifest.clips
      .filter(c => c.status !== "failed")
      .sort((a, b) => (a.section_order ?? 0) - (b.section_order ?? 0) ||
        (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name))
      .map(({ name, file, tier = "primary", section = "other", section_title = "Other lines" }) =>
        ({ name, file, tier, section, section_title }));
  }
  const find = file => clips().find(c => c.file === file);

  function command(file) {
    if (process.platform === "darwin") return ["afplay", [file]];
    return ["mpg123", ["-q", ...(device ? ["-a", device] : []), file]];
  }

  function play(file) {
    const clip = find(file);
    if (!clip) throw Object.assign(new Error("Unknown clip."), { status: 404 });
    if (current) current.kill();
    const [bin, args] = command(path.join(directory, clip.file));
    const child = start(bin, args, { stdio: "ignore" });
    current = child;
    child.on("error", error => console.warn("Arnold sound failed:", error.message));
    child.on("exit", () => { if (current === child) current = null; });
    return clip;
  }

  function stop() {
    if (current) current.kill();
    current = null;
  }

  function read(file) {
    const clip = find(file);
    return clip ? fs.promises.readFile(path.join(directory, clip.file)) : null;
  }

  return { clips, find, play, stop, read };
}

module.exports = { arnold };
