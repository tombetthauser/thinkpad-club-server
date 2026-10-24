const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function browser() {
  function element(properties = {}) {
    return Object.assign({ handlers: {}, tagName: 'BUTTON', disabled: false,
      addEventListener(name, fn) { this.handlers[name] = fn; },
      setPointerCapture() {}, matches() { return this.tagName === 'INPUT'; }
    }, properties);
  }
  const elements = Object.fromEntries(['status', 'connect', 'stop', 'controls', 'speed', 'speed-value'].map(id => [id, element()]));
  elements.controls.disabled = true;
  elements.speed.value = '.3';
  const forward = element({ dataset: { direction: 'forward' } });
  const document = element({ getElementById: id => elements[id], querySelectorAll: () => [forward], hidden: false });
  const window = element();
  const calls = [], timers = new Map();
  let timerId = 0;
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/robot.js'), 'utf8'), {
    document, window, crypto: { randomUUID: () => '12345678-1234-1234-1234-123456789012' },
    AbortSignal,
    setTimeout: callback => { timers.set(++timerId, callback); return timerId; },
    clearTimeout: id => timers.delete(id),
    fetch: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => ({ ready: true, state: url.split('/').pop() }) };
    }
  });
  const settle = () => new Promise(resolve => setImmediate(resolve));
  const pointer = { button: 0, pointerId: 42, preventDefault() {} };
  const key = name => ({ key: name, code: name === ' ' ? 'Space' : name, target: forward, preventDefault() {}, repeat: false });
  return { elements, forward, document, window, calls, timers, settle, pointer, key };
}

test('browser enables without a password, refreshes held movement, and sends stop on pointer release', async () => {
  const b = browser();
  b.forward.handlers.pointerdown(b.pointer);
  assert.equal(b.calls.length, 0);
  await b.elements.connect.onclick();
  b.forward.handlers.pointerdown(b.pointer);
  await b.settle();
  assert.equal(b.calls.at(-1).url, '/api/robot/forward');
  assert.equal(JSON.parse(b.calls.at(-1).options.body).speed, .3);
  assert.equal(b.calls.at(-1).options.headers['X-Robot-Password'], undefined);
  const refresh = [...b.timers.values()][0];
  b.timers.clear();
  await refresh();
  assert.equal(b.calls.filter(call => call.url.endsWith('/forward')).length, 2);
  b.forward.handlers.pointerup(b.pointer);
  await b.settle();
  assert.equal(b.calls.at(-1).url, '/api/robot/stop');
  assert.equal(b.timers.size, 0);
});

test('keyboard, touch cancellation, blur and hidden-page handlers stop movement', async () => {
  for (const reason of ['keyup', 'Escape', ' ', 'pointercancel', 'lostpointercapture', 'blur', 'hidden']) {
    const b = browser();
    await b.elements.connect.onclick();
    if (['pointercancel', 'lostpointercapture'].includes(reason)) b.forward.handlers.pointerdown(b.pointer);
    else b.document.handlers.keydown(b.key('ArrowUp'));
    await b.settle();
    if (reason === 'keyup') b.document.handlers.keyup(b.key('ArrowUp'));
    else if (['Escape', ' '].includes(reason)) b.document.handlers.keydown(b.key(reason));
    else if (['pointercancel', 'lostpointercapture'].includes(reason)) b.forward.handlers[reason](b.pointer);
    else if (reason === 'blur') b.window.handlers.blur();
    else { b.document.hidden = true; b.document.handlers.visibilitychange(); }
    await b.settle();
    assert.equal(b.calls.at(-1).url, '/api/robot/stop', reason);
    assert.equal(b.timers.size, 0, reason);
  }
});
