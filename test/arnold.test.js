const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { arnold } = require('../lib/arnold');

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
