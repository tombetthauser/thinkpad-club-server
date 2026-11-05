const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

function arnold(options = {}) {
  const directory = options.directory || path.join(__dirname, "..", "assets", "audio", "arnold-realm");
  const device = options.device || process.env.ARNOLD_SOUND_DEVICE || process.env.WEBCAM_SOUND_DEVICE || "plughw:1,0";
  const platform = options.platform || process.platform;
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
    if (platform === "darwin") return ["afplay", [file]];
    const wav = file.replace(/\.mp3$/, ".wav");
    if (!fs.existsSync(wav)) throw Object.assign(new Error("Server audio is missing. Deploy the prepared Arnold WAV files alongside the MP3s."), { status: 503 });
    return ["aplay", ["-q", "-D", device, wav]];
  }

  async function play(file) {
    options.audio?.assertAvailable();
    const clip = find(file);
    if (!clip) throw Object.assign(new Error("Unknown clip."), { status: 404 });
    if (current) current.kill();
    const [bin, args] = command(path.join(directory, clip.file));
    const child = start(bin, args, { stdio: ["ignore", "ignore", "inherit"], detached: process.platform !== 'win32' });
    options.audio?.track(child);
    current = child;
    child.on("exit", (code, signal) => {
      if (current === child) current = null;
      if (code && !signal) console.warn(`Arnold sound failed (${bin} exit ${code}). Check the audio device and service audio permissions.`);
    });
    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", error => {
        if (current === child) current = null;
        console.warn("Arnold sound failed:", error.message);
        reject(Object.assign(new Error(`Could not start ${bin}. ${platform === "darwin" ? error.message : "Install alsa-utils and check the service audio permissions."}`), { status: 503 }));
      });
    });
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
