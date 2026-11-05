const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture({ motor = true, statuses = [200], prompt = 'secret' } = {}) {
  const element = extra => ({ ...extra, addEventListener(type, callback) { this[type] = callback; } });
  const image = element({ src: '/webcam/current.jpg' });
  const update = element({ disabled: false });
  const cameraStatus = {}, motorStatus = {};
  const beepStatus = {};
  const beep = element({ disabled: false, parentElement: { querySelector: () => beepStatus } });
  const directions = ['left', 'right', 'backward', 'forward', 'dance'].map(move => element({ dataset: { move } }));
  const stop = element({});
  const speed = { value: '0.6' };
  const camera = { querySelector: selector => ({ img: image, button: update, '[role="status"]': cameraStatus })[selector] };
  const robot = { querySelector: selector => selector === '[data-stop]' ? stop : selector === '[data-device-speed]' ? speed : motorStatus, querySelectorAll: () => directions };
  const document = element({ hidden: false, querySelectorAll: () => [beep], querySelector: selector => selector === '[data-device-webcam]' ? camera : motor ? robot : null });
  const window = element({ prompt: () => prompt });
  const requests = [], timers = [], delays = [];
  let fail = false;
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/device-widgets.js'), 'utf8'), {
    document, window, AbortSignal, crypto: { randomUUID: () => '12345678-1234-1234-1234-123456789012' },
    setTimeout(callback, delay) { timers.push(callback); delays.push(delay); },
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (fail) throw new Error('Connection lost');
      const status = url === '/api/webcam/capture' ? (statuses.shift() ?? 200) : 200;
      return { ok: status === 200, status, text: async () => 'Camera unavailable', json: async () => ({ url: '/webcam/current.jpg?t=new' }) };
    }
  });
  return { image, update, cameraStatus, motorStatus, beep, beepStatus, directions, stop, speed, document, window, requests, timers, delays,
    fail: () => { fail = true; }, settle: () => new Promise(resolve => setImmediate(resolve)) };
}

test('Arnold direction buttons use 0.6 speed, run for 500 ms, and stop', async () => {
  for (const direction of ['left', 'right', 'backward', 'forward']) {
    const f = fixture();
    const button = f.directions.find(b => b.dataset.move === direction);
    const moving = button.click();
    await f.settle();
    await button.click(); // A second click cannot overlap a movement.
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].url, '/api/robot/' + direction);
    assert.equal(JSON.parse(f.requests[0].options.body).speed, 0.6);
    assert.equal(f.requests[0].options.headers['X-Robot-Controller'].length, 36);
    assert.deepEqual(f.delays, [500]);
    f.timers.shift()();
    await moving;
    assert.equal(f.requests.at(-1).url, '/api/robot/stop');
  }
});

test('Arnold dance uses the slider up to 1.0, alternates three pairs of short turns, and stops', async () => {
  const f = fixture();
  f.speed.value = '1';
  const moving = f.directions.at(-1).click();
  for (let i = 0; i < 11; i++) {
    await f.settle();
    f.timers.shift()();
  }
  await moving;
  assert.deepEqual(f.requests.slice(0, 12).map(r => r.url.split('/').pop()), Array(3).fill(['left', 'stop', 'right', 'stop']).flat());
  assert.ok(f.requests.every(r => JSON.parse(r.options.body).speed === 1));
  assert.equal(f.requests.at(-1).url, '/api/robot/stop');
});

test('Stop, blur, page exit, and hiding cancel dance; failures attempt a final stop', async () => {
  for (const event of ['stop', 'blur', 'pagehide', 'hidden', 'failure']) {
    const f = fixture();
    const moving = f.directions.at(-1).click();
    await f.settle();
    if (event === 'stop') f.stop.click();
    else if (event === 'hidden') { f.document.hidden = true; f.document.visibilitychange(); }
    else if (event === 'failure') f.fail();
    else f.window[event]();
    f.timers.shift()();
    await moving;
    assert.equal(f.requests.at(-1).url, '/api/robot/stop');
    if (event === 'failure') assert.match(f.motorStatus.textContent, /Connection lost/);
    else assert.equal(f.requests.filter(r => /\/(left|right)$/.test(r.url)).length, 1);
  }
});

test('webcam works without movement controls, retries passwords, and unlocks after errors/cancellation', async () => {
  const f = fixture({ motor: false, statuses: [401, 200] });
  const capture = f.update.click();
  assert.equal(f.update.disabled, true);
  await capture;
  assert.equal(f.image.src, '/webcam/current.jpg?t=new');
  assert.equal(f.requests[1].options.headers['X-Edit-Password'], 'secret');
  assert.equal(f.update.disabled, false);
  for (const options of [{ statuses: [503] }, { statuses: [401], prompt: null }]) {
    const g = fixture({ motor: false, ...options });
    await g.update.click();
    assert.equal(g.update.disabled, false);
    assert.equal(g.image.src, '/webcam/current.jpg');
    assert.match(g.cameraStatus.textContent, /unavailable|cancelled/);
  }
});

test('student beep button only calls the server and unlocks after success or failure', async () => {
  const f = fixture({ motor: false });
  await f.beep.click();
  assert.equal(f.requests[0].url, '/api/beep');
  assert.equal(f.requests[0].options.method, 'POST');
  assert.match(f.beepStatus.textContent, /Beep played on server/);
  assert.equal(f.beep.disabled, false);
  f.fail();
  await f.beep.click();
  assert.match(f.beepStatus.textContent, /Connection lost/);
  assert.equal(f.beep.disabled, false);
});
