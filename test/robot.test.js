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
    const reply = { id: command.id };
    if ('code' in command) {
      if (child.programError) reply.error = child.programError;
      else reply.steps = child.programSteps || [];
    }
    if (!child.hang) setImmediate(() => child.stdout.write(JSON.stringify(reply) + '\n'));
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

test('program validation uses the worker without movement and reports errors without killing it', async t => {
  const child = worker();
  const service = robot({ enabled: true, spawn: () => child });
  t.after(() => service.close());
  child.stdout.write('{"ready":true}\n');
  child.programSteps = [{ action: 'left', speed: .5 }];
  assert.deepEqual(await service.program('left(0.5)'), child.programSteps);
  assert.equal(child.commands[0].code, 'left(0.5)');
  assert.equal(child.commands[0].action, undefined);
  child.programError = 'Line 1: unsupported command';
  await assert.rejects(service.program('import os'), { status: 400 });
  assert.equal(service.status().ready, true);
  assert.equal(child.killed, undefined);
  for (const code of ['', ' ', null, 'x'.repeat(4097)]) {
    await assert.rejects(service.program(code), { status: 400 });
  }
  assert.equal(child.commands.length, 2);
  await service.command('forward', .3, 'one');
});

test('raw wheel commands retain validation, controller ownership, and expiry', async t => {
  const child = worker();
  const service = robot({ enabled: true, spawn: () => child });
  t.after(() => service.close());
  child.stdout.write('{"ready":true}\n');
  for (const speed of [.5, [0], [.7, 0], [0, NaN], [false, 0], ['0.5', 0]]) {
    await assert.rejects(service.command('wheels', speed, 'one'), { status: 400 });
  }
  await service.command('wheels', [.5, -.5], 'one');
  assert.equal(child.commands[0].action, 'wheels');
  assert.deepEqual(child.commands[0].speed, [.5, -.5]);
  assert.ok(child.commands[0].expires * 1000 <= Date.now() + 500);
  await assert.rejects(service.command('wheels', [.2, 0], 'two'), { status: 409 });
  await service.command('stop', undefined, 'two');
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
    program: async code => { assert.equal(code, 'left(0.5)'); return [{ action: 'left', speed: .5 }]; },
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
  assert.equal((await send({ Origin: base.replace('http:', 'https:') })).status, 200);
  const program = await send({ Origin: base }, '{"code":"left(0.5)"}', 'program');
  assert.equal(program.status, 200);
  assert.deepEqual(await program.json(), { steps: [{ action: 'left', speed: .5 }] });
  assert.equal((await send({ Origin: 'https://elsewhere.test' }, '{"code":"left(0.5)"}', 'program')).status, 403);
  const page = await fetch(`${base}/control`);
  const html = await page.text();
  assert.match(html, /move for half a second/);
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

test('robot controls honor the configured HTTPS public origin behind a proxy', async t => {
  const calls = [];
  const server = createServer({
    editPassword: 'class', publicOrigin: 'https://thinkpad.club',
    robot: { command: async (...args) => { calls.push(args); return { state: args[0] }; }, close() {} }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const send = origin => fetch(`${base}/api/robot/forward`, {
    method: 'POST',
    headers: { Origin: origin, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json',
      'X-Robot-Controller': '12345678-1234-1234-1234-123456789012' },
    body: '{"speed":0.3}'
  });
  assert.equal((await send('http://thinkpad.club')).status, 403);
  assert.equal((await send('https://elsewhere.test')).status, 403);
  assert.equal(calls.length, 0);
  assert.equal((await send('https://thinkpad.club')).status, 200);
  assert.equal(calls.length, 1);
});

function browser({ programError = '', holdProgram = false, programSteps } = {}) {
  const elements = {
    speed: { value: '.3' }, status: { textContent: 'Stopped' }, stop: {}, dance: {}, execute: {}, code: {}, easy: {}, hard: {}
  };
  const button = { dataset: { direction: 'forward' } };
  const document = {
    hidden: false, handlers: {},
    getElementById: id => elements[id], querySelectorAll: () => [button],
    addEventListener(name, callback) { this.handlers[name] = callback; }
  };
  const window = { handlers: {}, addEventListener(name, callback) { this.handlers[name] = callback; } };
  const calls = [], timers = [], delays = [];
  let fail = false;
  let releaseProgram;
  const programReady = new Promise(resolve => { releaseProgram = resolve; });
  const html = fs.readFileSync(require.resolve('../public/control.html'), 'utf8');
  elements.code.value = html.match(/<textarea[^>]*>([\s\S]*?)<\/textarea>/)[1];
  vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], {
    document, window, AbortSignal,
    crypto: { randomUUID: () => '12345678-1234-1234-1234-123456789012' },
    setTimeout(callback, delay) { timers.push(callback); delays.push(delay); },
    async fetch(url, options) {
      const action = url.split('/').pop();
      const body = JSON.parse(options.body);
      calls.push({ action, ...(action === 'program' ? { code: body.code } : { speed: body.speed }) });
      if (fail) throw new Error('Connection lost');
      if (action === 'program' && holdProgram) await programReady;
      return { ok: !(action === 'program' && programError), text: async () => programError,
        json: async () => ({ steps: programSteps || [
          { action: 'left', speed: .5 }, { action: 'right', speed: .5 },
          { action: 'forward', speed: .5 }, { action: 'backward', speed: .5 }
        ] }) };
    }
  });
  return { elements, button, document, window, calls, timers, delays,
    releaseProgram,
    fail: () => { fail = true; },
    settle: () => new Promise(resolve => setImmediate(resolve)) };
}

test('a direction click sends one movement command and stops after 500 ms', async () => {
  const page = browser();
  const move = page.button.onclick();
  await page.settle();
  assert.deepEqual(page.calls[0], { action: 'forward', speed: .3 });
  assert.deepEqual(page.delays, [500]);
  page.button.onclick();
  assert.equal(page.calls.length, 1);
  page.timers.shift()();
  await move;
  assert.equal(page.calls.filter(call => call.action === 'forward').length, 1);
  assert.equal(page.calls.at(-1).action, 'stop');
  assert.equal(page.timers.length, 0);
  assert.equal(page.elements.status.textContent, 'Stopped');
  assert.equal(page.button.onpointerdown, undefined);
});

test('Execute validates the editable Python then runs the default four moves at their coded speed', async () => {
  const page = browser();
  page.elements.easy.onclick();
  assert.equal(page.elements.code.value, 'left(0.5)\nright(0.5)\nforward(0.5)\nbackward(0.5)');
  page.elements.code.value += '\nstop()';
  page.elements.speed.value = '.1';
  const program = page.elements.execute.onclick();
  await page.settle();
  assert.equal(page.calls[0].action, 'program');
  assert.ok(page.calls[0].code.endsWith('stop()'));
  page.elements.execute.onclick();
  let steps = 0;
  while (page.timers.length) {
    assert.ok(++steps <= 4);
    page.timers.shift()();
    await page.settle();
  }
  await program;
  assert.deepEqual(page.calls.map(call => call.action), ['program', 'left', 'right', 'forward', 'backward', 'stop']);
  assert.ok(page.calls.slice(1, -1).every(call => call.speed === .5));
  assert.deepEqual(page.delays, [500, 500, 500, 500]);
  assert.equal(page.elements.status.textContent, 'Stopped');
});

test('Hard is the default and mode buttons replace the editor without executing', () => {
  const page = browser();
  const hard = page.elements.code.value;
  assert.ok(hard.startsWith('from gpiozero import Motor'));
  assert.ok(hard.includes('RIGHT_FORWARD = 22'));
  assert.ok(hard.includes('right_motor.value = -right_speed'));
  assert.ok(hard.includes('turn_left(0.5, 0.5)'));
  page.elements.easy.onclick();
  assert.equal(page.elements.code.value, 'left(0.5)\nright(0.5)\nforward(0.5)\nbackward(0.5)');
  page.elements.code.value = 'left(0.2)';
  page.elements.hard.onclick();
  assert.equal(page.elements.code.value, hard);
  assert.equal(page.calls.length, 0);
});

test('Hard runs raw wheel steps for their compiled duration and preserves the watchdog refresh', async () => {
  const page = browser({ programSteps: [
    { action: 'wheels', speed: [-.5, -.5], duration: 250 },
    { action: 'wheels', speed: [.5, .5], duration: 250 }
  ] });
  const hard = page.elements.code.value;
  const program = page.elements.execute.onclick();
  await page.settle();
  page.elements.easy.onclick();
  assert.equal(page.elements.code.value, hard);
  assert.deepEqual(page.calls[1], { action: 'wheels', speed: [-.5, -.5] });
  page.timers.shift()();
  await page.settle();
  assert.deepEqual(page.calls[2], { action: 'wheels', speed: [.5, .5] });
  page.timers.shift()();
  await program;
  assert.deepEqual(page.delays, [250, 250]);
  assert.equal(page.calls.at(-1).action, 'stop');
});

test('invalid Python reports the error before any movement', async () => {
  const page = browser({ programError: 'Line 2: use a motor command.' });
  await page.elements.execute.onclick();
  assert.deepEqual(page.calls.map(call => call.action), ['program', 'stop']);
  assert.equal(page.elements.status.textContent, 'Line 2: use a motor command.');
  assert.equal(page.timers.length, 0);
});

test('Stop cancels a Python program even while validation is pending', async () => {
  const page = browser({ holdProgram: true });
  const program = page.elements.execute.onclick();
  await page.settle();
  page.elements.stop.onclick();
  page.releaseProgram();
  await program;
  assert.ok(page.calls.every(call => ['program', 'stop'].includes(call.action)));
  assert.equal(page.timers.length, 0);
});

test('Stop and hiding the page cancel the remaining Python movements', async () => {
  for (const reason of ['stop', 'hidden']) {
    const page = browser();
    const program = page.elements.execute.onclick();
    await page.settle();
    assert.equal(page.calls.at(-1).action, 'left');
    if (reason === 'stop') page.elements.stop.onclick();
    else { page.document.hidden = true; page.document.handlers.visibilitychange(); }
    page.timers.shift()();
    await program;
    assert.equal(page.calls.filter(call => ['left', 'right', 'forward', 'backward'].includes(call.action)).length, 1);
    assert.equal(page.calls.at(-1).action, 'stop');
    assert.equal(page.timers.length, 0);
  }
});

test('each direction uses the slider and accepts a new click after stopping', async () => {
  const page = browser();
  page.elements.speed.value = '.5';
  for (const action of ['forward', 'backward', 'left', 'right']) {
    page.button.dataset.direction = action;
    const move = page.button.onclick();
    await page.settle();
    assert.deepEqual(page.calls.at(-1), { action, speed: .5 });
    page.timers.shift()();
    await move;
    assert.equal(page.calls.at(-1).action, 'stop');
  }
  assert.deepEqual(page.delays, [500, 500, 500, 500]);
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

test('stop, blur, page exit, and hidden tabs cancel movement', async () => {
  for (const reason of ['stop', 'blur', 'pagehide', 'hidden']) {
    const page = browser();
    page.button.onclick();
    await page.settle();
    if (reason === 'stop') page.elements.stop.onclick();
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
