const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { youtube, videoURL } = require('../lib/youtube');
const { audioControl } = require('../lib/audio-control');

function fixture(options = {}) {
  const children = [];
  const audio = audioControl();
  const videos = youtube({ audio, platform: 'linux', ...options, spawn: (command, args) => {
    const child = Object.assign(new EventEmitter(), { command, args, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() });
    child.kill = () => {
      if (child.closed) return;
      child.closed = true;
      queueMicrotask(() => { child.stdout.end(); child.stdin.destroy(); child.emit('close', 0); });
    };
    children.push(child);
    queueMicrotask(() => {
      if (options.failCommand === command) { child.emit('error', Object.assign(new Error('missing'), { code: 'ENOENT' })); child.kill(); }
      else child.emit('spawn');
    });
    return child;
  } });
  return { videos, audio, children, settle: () => new Promise(r => setImmediate(r)) };
}

test('YouTube URLs are normalized to a single video and other sites/credentials are rejected', () => {
  for (const url of ['https://youtu.be/BaW_jenozKc', 'https://www.youtube.com/watch?v=BaW_jenozKc&list=ignored', 'https://youtube.com/shorts/BaW_jenozKc']) {
    assert.equal(videoURL(url), 'https://www.youtube.com/watch?v=BaW_jenozKc');
  }
  for (const url of ['file:///etc/passwd', 'https://localhost/test', 'https://youtube.com.evil.test/watch?v=BaW_jenozKc', 'https://youtube.com/playlist?list=test', 'https://user@youtube.com/watch?v=BaW_jenozKc']) {
    assert.throws(() => videoURL(url), { status: 400 });
  }
});

test('stream reserves audio before extraction, pipes through aplay, and never queues', async () => {
  const f = fixture();
  const first = f.videos.play('https://youtu.be/BaW_jenozKc', 'owner');
  await assert.rejects(f.videos.play('https://youtu.be/BaW_jenozKc', 'other'), { status: 409 });
  assert.equal(f.children.length, 3);
  await f.settle();
  assert.deepEqual(f.children.map(c => c.command), ['yt-dlp', 'ffmpeg', 'aplay']);
  assert.equal(f.children[0].args[f.children[0].args.indexOf('-o') + 1], '-');
  assert.ok(f.children[0].args.includes('--no-cache-dir'));
  f.children[1].stdout.write(Buffer.from([0, 0, 0, 0]));
  await first;
  assert.equal(f.videos.status().playing, true);
  assert.throws(() => f.audio.assertAvailable(), { status: 409 });
  assert.throws(() => f.videos.stop('other'), { status: 403 });
  f.videos.stop('owner');
  await f.settle();
  assert.equal(f.videos.status().playing, false);
  assert.equal(f.audio.status().busy, false);
  assert.ok(f.children.every(c => c.closed));
});

test('missing dependencies clear the busy lock and admin disable kills all stream processes', async () => {
  const missing = fixture({ failCommand: 'yt-dlp' });
  await assert.rejects(missing.videos.play('https://youtu.be/BaW_jenozKc', 'owner'), { status: 503 });
  await missing.settle();
  assert.equal(missing.audio.status().busy, false);
  const f = fixture();
  const playing = f.videos.play('https://youtu.be/BaW_jenozKc', 'owner');
  await f.settle();
  f.children[1].stdout.write(Buffer.alloc(4));
  await playing;
  f.audio.setEnabled(false);
  f.videos.stop(null, true);
  await f.settle();
  assert.ok(f.children.every(c => c.closed));
  await assert.rejects(f.videos.play('https://youtu.be/BaW_jenozKc', 'owner'), { status: 503 });
  f.audio.setEnabled(true);
  assert.equal(f.audio.canPlay(), true);
});

test('the playback time limit tears down the pipeline and releases the lock', async () => {
  const f = fixture({ maxMs: 40 });
  const pending = f.videos.play('https://youtu.be/BaW_jenozKc', 'owner');
  await f.settle();
  f.children[1].stdout.write(Buffer.alloc(4));
  await pending;
  await new Promise(r => setTimeout(r, 70));
  assert.equal(f.videos.status().playing, false);
  assert.equal(f.audio.status().busy, false);
});
