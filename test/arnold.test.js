const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { arnold } = require('../lib/arnold');
const { PassThrough } = require('node:stream');

test('Pi playback uses aplay on the webcam beep device with a WAV; stop kills that player', async t => {
  const previous = process.env.WEBCAM_SOUND_DEVICE;
  const previousArnold = process.env.ARNOLD_SOUND_DEVICE;
  process.env.WEBCAM_SOUND_DEVICE = 'plughw:CARD=USB,DEV=0';
  delete process.env.ARNOLD_SOUND_DEVICE;
  t.after(() => {
    if (previous === undefined) delete process.env.WEBCAM_SOUND_DEVICE;
    else process.env.WEBCAM_SOUND_DEVICE = previous;
    if (previousArnold !== undefined) process.env.ARNOLD_SOUND_DEVICE = previousArnold;
  });
  let killed = false;
  const sounds = arnold({ platform: 'linux', spawn: (command, args, options) => {
    assert.equal(command, 'aplay');
    assert.deepEqual(args.slice(0, 3), ['-q', '-D', 'plughw:CARD=USB,DEV=0']);
    assert.match(args.at(-1), /primary\/choppa.wav$/);
    assert.equal(options.stdio[2], 'inherit');
    const child = Object.assign(new EventEmitter(), { kill() { killed = true; } });
    queueMicrotask(() => child.emit('spawn'));
    return child;
  } });
  assert.equal((await sounds.play('primary/choppa.mp3')).name, 'Get to the chopper!');
  sounds.stop();
  assert.equal(killed, true);
});

test('a missing player produces a readable 503 instead of reporting playback success', async () => {
  const sounds = arnold({ platform: 'linux', spawn: () => {
    const child = new EventEmitter();
    queueMicrotask(() => child.emit('error', Object.assign(new Error('spawn aplay ENOENT'), { code: 'ENOENT' })));
    return child;
  } });
  await assert.rejects(sounds.play('primary/choppa.mp3'), { status: 503, message: /alsa-utils/ });
});

test('speech sends text via stdin to espeak-ng and pipes WAV to the configured Pi speaker', async () => {
  const calls = [];
  const sounds = arnold({ platform: 'linux', device: 'plughw:test', spawn: (bin, args, options) => {
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), kill() { this.killed = true; } });
    calls.push({ bin, args, options, child });
    queueMicrotask(() => child.emit('spawn'));
    return child;
  } });
  await assert.rejects(sounds.speak(' '.repeat(2)), { status: 400 });
  await assert.rejects(sounds.speak('a'.repeat(301)), { status: 400 });
  await sounds.speak('--hello');
  assert.deepEqual(calls.map(c => c.bin), ['espeak-ng', 'aplay']);
  assert.deepEqual(calls[0].args, ['--stdout', '--stdin']);
  assert.deepEqual(calls[1].args, ['-q', '-D', 'plughw:test']);
  assert.equal(calls[0].child.stdin.read().toString(), '--hello');
  sounds.stop();
  assert.ok(calls.every(c => c.child.killed));
});

test('speech reports a missing synthesizer and stops the player', async () => {
  const children = [];
  const sounds = arnold({ platform: 'linux', spawn: bin => {
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), kill() { this.killed = true; } });
    children.push(child);
    queueMicrotask(() => bin === 'espeak-ng' ? child.emit('error', new Error('not installed')) : child.emit('spawn'));
    return child;
  } });
  await assert.rejects(sounds.speak('Hello'), { status: 503, message: /espeak-ng/ });
  assert.ok(children.every(child => child.killed));
});
