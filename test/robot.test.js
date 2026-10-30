const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter, once } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const { robot } = require('../lib/robot');
const { createServer } = require('../server');
const fs = require('node:fs');
const vm = require('node:vm');
const { createHash } = require('node:crypto');

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
  const service = robot({ enabled: true, spawn: (python, args) => {
    assert.equal(args[0], '-u');
    assert.equal(args[1], require.resolve('../lib/motors.py'));
    return child;
  } });
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
  assert.equal((await fetch(`${base}/api/robot/status`)).status, 404);
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
  const page = await fetch(`${base}/control`);
  const html = await page.text();
  assert.match(html, /Hold to move/);
  assert.match(html, /Rotate left/);
  assert.match(html, /Rotate right/);
  assert.match(html, /id="dance"/);
  assert.match(html, /type="range"/);
  assert.doesNotMatch(html, /type="password"/);
  assert.doesNotMatch(html, /<style|stylesheet|\/assets\/robot|id="connect"|calibration/i);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const hash = createHash('sha256').update(script).digest('base64');
  assert.ok(page.headers.get('content-security-policy').includes(`script-src 'sha256-${hash}'`));
  assert.equal((await fetch(`${base}/assets/robot.js`)).status, 404);
  assert.equal((await fetch(`${base}/assets/robot.css`)).status, 404);
  assert.equal((await fetch(`${base}/robot`)).status, 404);
  assert.equal((await fetch(`${base}/api/pages/control`)).status, 404);
  await new Promise(resolve => server.close(resolve));
  assert.equal(closed, true);
});

function browser() {
  const elements = {
    speed: { value: '.3' }, status: { textContent: 'Stopped' }, stop: {}, dance: {}
  };
  const button = { dataset: { direction: 'forward' }, setPointerCapture() {} };
  const document = {
    hidden: false, handlers: {},
    getElementById: id => elements[id], querySelectorAll: () => [button],
    addEventListener(name, callback) { this.handlers[name] = callback; }
  };
  const window = { handlers: {}, addEventListener(name, callback) { this.handlers[name] = callback; } };
  const calls = [], timers = [], delays = [];
  let fail = false;
  const html = fs.readFileSync(require.resolve('../public/control.html'), 'utf8');
  vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], {
    document, window, AbortSignal,
    crypto: { randomUUID: () => '12345678-1234-1234-1234-123456789012' },
    setTimeout(callback, delay) { timers.push(callback); delays.push(delay); },
    async fetch(url, options) {
      calls.push({ action: url.split('/').pop(), speed: JSON.parse(options.body).speed });
      if (fail) throw new Error('Connection lost');
      return { ok: true };
    }
  });
  return { elements, button, document, window, calls, timers, delays,
    fail: () => { fail = true; },
    settle: () => new Promise(resolve => setImmediate(resolve)),
    pointer: { button: 0, pointerId: 1, preventDefault() {} } };
}

test('plain controls refresh while held and stop on release', async () => {
  const page = browser();
  page.button.onpointerdown(page.pointer);
  await page.settle();
  assert.deepEqual(page.calls[0], { action: 'forward', speed: .3 });
  page.timers.shift()();
  await page.settle();
  assert.equal(page.calls.filter(call => call.action === 'forward').length, 2);
  page.button.onpointerup(page.pointer);
  await page.settle();
  page.timers.shift()();
  await page.settle();
  assert.equal(page.calls.at(-1).action, 'stop');
  assert.equal(page.timers.length, 0);
});

test('dance uses the slider, alternates six short turns, and finishes stopped', async () => {
  const page = browser();
  page.elements.speed.value = '.45';
  const dance = page.elements.dance.onclick();
  await page.settle();
  page.elements.dance.onclick();
  let steps = 0;
  while (page.timers.length) {
    assert.ok(++steps < 20);
    page.timers.shift()();
    await page.settle();
  }
  await dance;
  assert.deepEqual(page.calls.map(call => call.action), [
    'left', 'stop', 'right', 'stop', 'left', 'stop', 'right', 'stop',
    'left', 'stop', 'right', 'stop', 'stop'
  ]);
  assert.ok(page.calls.every(call => call.speed === .45));
  assert.deepEqual(page.delays, [150, 100, 150, 100, 150, 100, 150, 100, 150, 100, 150]);
  assert.equal(page.elements.status.textContent, 'Stopped');
});

test('stop, touch cancellation, lost capture, blur, page exit, and hidden tabs cancel movement', async () => {
  for (const reason of ['stop', 'pointercancel', 'lostpointercapture', 'blur', 'pagehide', 'hidden']) {
    const page = browser();
    page.button.onpointerdown(page.pointer);
    await page.settle();
    if (reason === 'stop') page.elements.stop.onclick();
    else if (reason === 'pointercancel' || reason === 'lostpointercapture') page.button[`on${reason}`](page.pointer);
    else if (reason === 'hidden') { page.document.hidden = true; page.document.handlers.visibilitychange(); }
    else page.window.handlers[reason]();
    await page.settle();
    page.timers.shift()();
    await page.settle();
    assert.equal(page.calls.filter(call => call.action !== 'stop').length, 1, reason);
    assert.equal(page.calls.at(-1).action, 'stop', reason);
    assert.equal(page.timers.length, 0, reason);
  }
});

test('dance stops after cancellation or a connection failure', async () => {
  for (const reason of ['stop', 'network']) {
    const page = browser();
    const dance = page.elements.dance.onclick();
    await page.settle();
    if (reason === 'stop') page.elements.stop.onclick();
    else page.fail();
    page.timers.shift()();
    await page.settle();
    await dance;
    assert.equal(page.calls.filter(call => ['left', 'right'].includes(call.action)).length, 1);
    assert.equal(page.calls.at(-1).action, 'stop');
    assert.equal(page.timers.length, 0);
    if (reason === 'network') assert.equal(page.elements.status.textContent, 'Connection lost');
  }
});

test('robot defaults to disabled without affecting health', async t => {
  const service = robot({ enabled: false });
  assert.equal(service.status().ready, false);
  await assert.rejects(service.command('forward', .3, 'one'), { status: 503 });
  service.close();
});
