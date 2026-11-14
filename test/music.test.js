const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { spawn } = require("node:child_process");
const { music } = require("../lib/music");

test("music import validates URLs, limits downloads, and stores the converted audio", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "music-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let release;
  let args;
  const importer = music({ directory, spawn: (command, received, options) => {
    args = received;
    assert.equal(command, process.env.YTDLP_BIN || "yt-dlp");
    assert.equal(options.detached, process.platform !== "win32");
    const child = Object.assign(new EventEmitter(), { stderr: new PassThrough(), kill() {} });
    release = async () => {
      await fs.writeFile(args[args.indexOf("-o") + 1].replace("%(ext)s", "mp3"), "audio");
      child.emit("close", 0);
    };
    return child;
  } });
  await assert.rejects(importer.download("https://example.com"), { status: 400 });
  const pending = importer.download("https://youtu.be/BaW_jenozKc");
  while (!release) await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(importer.download("https://youtu.be/BaW_jenozKc"), { status: 409 });
  assert.ok(args.includes("--ignore-config"));
  assert.ok(args.includes("--max-filesize"));
  assert.ok(args.includes("duration > 0 & duration <= 600"));
  assert.equal(args.at(-1), "https://www.youtube.com/watch?v=BaW_jenozKc");
  await release();
  const result = await pending;
  assert.match(result.url, /^\/uploads\/[a-f0-9-]{36}\.mp3$/);
  assert.equal(await fs.readFile(path.join(directory, path.basename(result.url)), "utf8"), "audio");
  assert.deepEqual(await fs.readdir(directory), [path.basename(result.url)]);
});

test("failed music imports clean temporary files and report errors", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "music-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const importer = music({ directory, spawn: () => {
    const child = Object.assign(new EventEmitter(), { stderr: new PassThrough(), kill() {} });
    queueMicrotask(() => child.emit("close", 1));
    return child;
  } });
  await assert.rejects(importer.download("https://youtu.be/BaW_jenozKc"), { status: 422 });
  assert.deepEqual(await fs.readdir(directory), []);
});

test("missing downloader and timeouts release the import slot and clean up", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "music-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const missing = music({ directory, spawn: (_command, _args, options) => spawn(path.join(directory, "missing-yt-dlp"), [], options) });
  await assert.rejects(missing.download("https://youtu.be/BaW_jenozKc"), { status: 503 });
  const timeout = music({ directory, timeoutMs: 50, spawn: (_command, _args, options) =>
    spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], options) });
  await assert.rejects(timeout.download("https://youtu.be/BaW_jenozKc"), { status: 504 });
  await assert.rejects(timeout.download("https://youtu.be/BaW_jenozKc"), { status: 504 });
  assert.deepEqual(await fs.readdir(directory), []);
});
