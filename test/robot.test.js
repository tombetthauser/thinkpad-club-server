const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter, once } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const { robot } = require('../lib/robot');
const { createServer } = require('../server');

function worker() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.commands = [];
  child.stdin = new Writable({ write(bytes, _, done) {
    const command = JSON.parse(bytes);
    child.commands.push(command);
    if (!child.hang) setImmediate(() => child.stdout.write(JSON.stringify({ id: command.id }) + '\n'));
    done();
  } });
  child.kill = () => { child.killed = true; };
  return child;
}

test('robot serializes commands, enforces lease, validates speed, and allows emergency stop by another controller', async t => {
  const child = worker();
  const service = robot({ enabled: true, spawn: () => child });
  t.after(() => service.close());
  child.stdout.write('{"ready":true}\n');
  const moving = service.command('forward', .3, 'one');
  await assert.rejects(service.command('left', .3, 'two'), { status: 409 });
  assert.equal((await moving).state, 'forward');
  await assert.rejects(service.command('left', .3, 'two'), { status: 409 });
  for (const speed of [-1, .61, '0.3', NaN, Infinity]) {
    await assert.rejects(service.command('forward', speed, 'one'), { status: 400 });
  }
  assert.equal((await service.command('stop', undefined, 'two')).state, 'stop');
  await service.command('right', .2, 'two');
  assert.equal(child.commands[0].expires * 1000 <= Date.now() + 500, true);
  await new Promise(resolve => setTimeout(resolve, 510));
  assert.equal(service.status().state, 'stop');
  await service.command('left', .2, 'one');
});

test('worker acknowledgement timeout fails closed and closes stdin', async () => {
  const child = worker();
  child.hang = true;
  const service = robot({ enabled: true, spawn: () => child });
  child.stdout.write('{"ready":true}\n');
  await assert.rejects(service.command('forward', .3, 'one'), { status: 503 });
  assert.equal(service.status().ready, false);
  assert.equal(child.killed, true);
  assert.equal(child.stdin.destroyed, true);
});

test('emergency stop is written immediately even with a movement pending', async t => {
  const child = worker();
  const service = robot({ enabled: true, spawn: () => child });
  t.after(() => service.close());
  child.stdout.write('{"ready":true}\n');
  const move = service.command('forward', .3, 'one');
  const stop = service.command('stop', undefined, 'two');
  assert.deepEqual(child.commands.map(command => command.action), ['forward', 'stop']);
  await Promise.all([move, stop]);
  assert.equal(service.status().state, 'stop');
});

test('motor routes work without passwords and require same origin, explicit JSON and controller identity', async t => {
  const calls = [];
  let closed = false;
  const motors = {
    status: () => ({ ready: true }),
    command: async (...args) => { calls.push(args); return { state: args[0] }; },
    close: () => { closed = true; }
  };
  const server = createServer({ robot: motors, editPassword: 'class', publicOrigin: '' });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { 'Content-Type': 'application/json', 'X-Robot-Controller': '12345678-1234-1234-1234-123456789012' };
  const send = (extra = {}, body = '{"speed":0.3}', action = 'forward') => fetch(`${base}/api/robot/${action}`, { method: 'POST', headers: { ...headers, ...extra }, body });
  assert.equal((await fetch(`${base}/api/robot/status`)).status, 200);
  assert.equal((await send({ Origin: 'https://elsewhere.test' })).status, 403);
  assert.equal((await send({ Origin: 'null' })).status, 403);
  assert.equal((await send({ 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await send({ 'X-Robot-Controller': '' })).status, 400);
  assert.equal((await send({ 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await send({}, '{')).status, 400);
  assert.equal((await send({}, 'null')).status, 400);
  assert.equal((await fetch(`${base}/api/robot/forward`, { headers })).status, 405);
  assert.equal(calls.length, 0);
  assert.equal((await send({ Origin: base })).status, 200);
  assert.deepEqual(calls[0], ['forward', .3, headers['X-Robot-Controller']]);
  const page = await fetch(`${base}/robot`);
  const html = await page.text();
  assert.match(html, /Hold to move/);
  assert.doesNotMatch(html, /type="password"/);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal((await fetch(`${base}/assets/robot.js`)).status, 200);
  await new Promise(resolve => server.close(resolve));
  assert.equal(closed, true);
});

test('robot defaults to disabled without affecting health', async t => {
  const service = robot({ enabled: false });
  assert.equal(service.status().ready, false);
  await assert.rejects(service.command('forward', .3, 'one'), { status: 503 });
  service.close();
});
