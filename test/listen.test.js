const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { listen } = require('../lib/listen');

function fakeChild(onOffer) {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), killed: false });
  child.kill = () => { child.killed = true; };
  child.stdin.once('data', line => onOffer(JSON.parse(line), child));
  return child;
}

test('answers an offer through the Python listener on the ALSA mic; a new call hangs up the old one', async () => {
  const children = [];
  const listener = listen({ platform: 'linux', device: 'plughw:2,0', spawn: (command, args) => {
    assert.equal(command, 'python3');
    assert.match(args[0], /listen\.py$/);
    assert.deepEqual(args.slice(1), ['alsa', 'plughw:2,0']);
    const child = fakeChild((offer, self) => self.stdout.write(JSON.stringify({ type: 'answer', sdp: 'for ' + offer.sdp }) + '\n'));
    children.push(child);
    return child;
  } });
  assert.deepEqual(await listener.answer({ type: 'offer', sdp: 'one' }), { type: 'answer', sdp: 'for one' });
  await listener.answer({ type: 'offer', sdp: 'two' });
  assert.equal(children[0].killed, true);
  listener.stop();
  assert.equal(children[1].killed, true);
});

test('a listener that exits before answering produces a readable 503', async () => {
  const listener = listen({ platform: 'linux', spawn: () => fakeChild((offer, self) => self.emit('exit', 1)) });
  await assert.rejects(listener.answer({ type: 'offer', sdp: 'x' }), { status: 503, message: /ARNOLD_MIC_DEVICE/ });
});
