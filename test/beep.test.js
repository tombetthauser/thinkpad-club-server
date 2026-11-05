const { test } = require('node:test');
const assert = require('node:assert/strict');
const { beep } = require('../lib/beep');

test('beep runs the working Python cue, rejects overlapping requests, and releases after failure', async () => {
  let release;
  let fail = false;
  const waiting = new Promise(resolve => { release = resolve; });
  const speaker = beep({ run: async (command, args, options) => {
    assert.equal(command, 'python3');
    assert.match(args[0], /beep-1-up.py$/);
    assert.equal(options.timeout, 5000);
    await waiting;
    if (fail) throw new Error('No speaker');
  } });
  const first = speaker.play();
  await assert.rejects(speaker.play(), { status: 409 });
  release();
  await first;
  fail = true;
  await assert.rejects(speaker.play(), { status: 503 });
  fail = false;
  await speaker.play();
});
