const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { webcam } = require("../lib/webcam");

const FIRST = Buffer.from([255, 216, 255, 1]);
const SECOND = Buffer.from([255, 216, 255, 2]);

async function folder(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "thinkpad-webcam-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test("webcam captures full-HD YUYV at high JPEG quality, serves the latest JPEG, and archives the old one", async t => {
  const directory = await folder(t);
  const calls = [];
  const camera = webcam({ directory, device: "/dev/video-test", run: async (command, args, options) => {
    calls.push({ command, args, options });
    await fs.writeFile(args.at(-1), calls.length === 1 ? FIRST : SECOND);
  } });
  await assert.rejects(camera.image(), { status: 404 });
  const first = await camera.capture();
  assert.match(first.url, /^\/webcam\/current.jpg\?t=/);
  assert.deepEqual(await camera.image(), FIRST);
  const second = await camera.capture();
  assert.notEqual(first.url, second.url);
  assert.deepEqual(await camera.image(), SECOND);
  const archives = await fs.readdir(path.join(directory, "archive"));
  assert.equal(archives.length, 1);
  assert.deepEqual(await fs.readFile(path.join(directory, "archive", archives[0])), FIRST);
  assert.deepEqual(calls[0].args.slice(0, -1), ["-d", "/dev/video-test", "-p", "YUYV", "-r", "1920x1080", "--no-banner", "-S", "20", "--jpeg", "95"]);
  assert.equal(calls[0].command, "fswebcam");
  assert.equal(calls[0].options.timeout, 20000);
  assert.equal((await fs.readdir(directory)).some(name => name.startsWith(".capture-")), false);
});

test("missing tool, disconnected camera, timeouts, and bad output preserve the last photo", async t => {
  const directory = await folder(t);
  await fs.writeFile(path.join(directory, "current.jpg"), FIRST);
  for (const [code, status] of [["ENOENT", 503], [1, 503], ["ETIMEDOUT", 504]]) {
    const camera = webcam({ directory, run: async () => { throw Object.assign(new Error("failure"), { code }); } });
    await assert.rejects(camera.capture(), { status });
    assert.deepEqual(await camera.image(), FIRST);
  }
  const invalid = webcam({ directory, run: async (_command, args) => fs.writeFile(args.at(-1), "not a JPEG") });
  await assert.rejects(invalid.capture(), { status: 503 });
  assert.deepEqual(await invalid.image(), FIRST);
  assert.deepEqual(await fs.readdir(directory), ["current.jpg"]);
});

test("simultaneous captures are rejected and the lock is released after failure", async t => {
  const directory = await folder(t);
  let release;
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const waiting = new Promise(resolve => { release = resolve; });
  let calls = 0;
  const camera = webcam({ directory, run: async (_command, args) => {
    calls++;
    if (calls === 1) {
      entered();
      await waiting;
      throw new Error("camera unplugged");
    }
    await fs.writeFile(args.at(-1), FIRST);
  } });
  const first = camera.capture();
  await started;
  await assert.rejects(camera.capture(), { status: 409 });
  release();
  await assert.rejects(first, { status: 503 });
  await camera.capture();
  assert.deepEqual(await camera.image(), FIRST);
});
