const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { audioControl } = require('../lib/audio-control');

test('audio disables current players, rejects new playback, and re-enables without resuming', () => {
  const audio = audioControl();
  let killed = 0;
  const child = Object.assign(new EventEmitter(), { kill() { killed++; } });
  audio.track(child);
  assert.throws(() => audio.acquireStream(), { status: 409 });
  audio.setEnabled(false);
  assert.equal(killed, 1);
  assert.equal(audio.canPlay(), false);
  assert.throws(() => audio.assertAvailable(), { status: 503 });
  child.emit('close');
  audio.setEnabled(true);
  assert.equal(killed, 1);
  const release = audio.acquireStream();
  assert.throws(() => audio.acquireStream(), { status: 409 });
  release(); release();
  assert.equal(audio.status().busy, false);
});
