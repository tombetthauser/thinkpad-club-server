const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const vm = require('node:vm');
const path = require('node:path');

async function fixture({ failCapture = false, failRobot = false, requiresPassword = false,
  prompts = [], holdCapture = false, holdRotation = false } = {}) {
  const requests = [], routes = [], alerts = [], waits = [];
  const animations = new Map();
  let animationId = 0, releaseCapture;
  const captureReady = new Promise(resolve => { releaseCapture = resolve; });
  const preview = { addEventListener(type, fn) { this[type] = fn; } };
  const context = vm.createContext({
    URL, AbortSignal,
    setInterval(callback) { animations.set(++animationId, callback); return animationId; },
    clearInterval(id) { animations.delete(id); },
    crypto: { randomUUID: () => '12345678-1234-1234-1234-123456789012' },
    setTimeout: callback => holdRotation ? waits.push(callback) : setImmediate(callback),
    location: { pathname: '/', href: 'https://thinkpad.club/', assign: url => routes.push(url) },
    document: { getElementById: () => preview },
    window: { prompt: () => prompts.shift() ?? null, alert: message => alerts.push(message) },
    fetch: async (url, options) => {
      requests.push({ url, ...options });
      const camera = url === '/api/webcam/capture';
      if (camera && holdCapture) await captureReady;
      const unauthorized = camera && requiresPassword && options.headers['X-Edit-Password'] !== 'secret';
      const failed = camera ? failCapture : failRobot;
      return {
        status: unauthorized ? 401 : failed ? 503 : 200,
        ok: !unauthorized && !failed,
        text: async () => unauthorized ? 'Password required' : camera ? 'Camera disconnected' : 'Robot disabled',
        json: async () => ({ url: '/webcam/current.jpg?t=new' })
      };
    }
  });
  vm.runInContext(await fs.readFile(path.join(__dirname, '../public/viewer.js'), 'utf8'), context);
  const button = { disabled: false };
  const left = { disabled: false, dataset: { robotDirection: 'left' } };
  const right = { disabled: false, dataset: { robotDirection: 'right' } };
  const image = { src: '/webcam/current.jpg?t=old', hidden: false };
  const label = { textContent: '' }, message = { textContent: '' };
  const spinner = { textContent: '' }, leftSpinner = { textContent: '' }, rightSpinner = { textContent: '' };
  const selectors = {
    '[data-webcam-status]': label, '[data-webcam-spinner]': spinner,
    '[data-robot-status]': message,
    '[data-robot-spinner="left"]': leftSpinner,
    '[data-robot-spinner="right"]': rightSpinner
  };
  const doc = {
    querySelector: selector => selectors[selector] || null,
    querySelectorAll: selector => ({
      '[data-webcam-update], [data-robot-direction]': [button, left, right],
      '[data-webcam-update]': [button], '[data-webcam-image]': [image], '[data-webcam-status]': [label]
    })[selector] || []
  };
  const widget = { querySelector: doc.querySelector };
  left.closest = right.closest = () => widget;
  return { context, preview, requests, routes, alerts, button, left, right, image, label, message,
    spinner, leftSpinner, rightSpinner, doc, widget, waits, animations, releaseCapture };
}

test('standalone webcam updates keep the old image on failure and reenable the button', async () => {
  for (const failCapture of [false, true]) {
    const f = await fixture({ failCapture });
    await f.context.updateWebcam(f.doc, f.widget);
    assert.equal(f.requests[0].method, 'POST');
    assert.equal(f.button.disabled, false);
    assert.equal(f.image.src, failCapture ? '/webcam/current.jpg?t=old' : '/webcam/current.jpg?t=new');
    if (failCapture) assert.match(f.label.textContent, /Camera disconnected/);
    else assert.equal(f.label.textContent, "");
  }
});

test('rotation stops before taking a webcam photo at half speed', async () => {
  for (const direction of ['left', 'right']) {
    const f = await fixture();
    const rotation = f.context.updateWebcam(f.doc, f.widget, direction);
    assert.ok([f.button, f.left, f.right].every(button => button.disabled));
    await f.context.updateWebcam(f.doc, f.widget, direction);
    await rotation;
    assert.deepEqual(f.requests.map(request => request.url), [
      `/api/robot/${direction}`, '/api/robot/stop', '/api/webcam/capture'
    ]);
    assert.equal(JSON.parse(f.requests[0].body).speed, .5);
    assert.equal(f.image.src, '/webcam/current.jpg?t=new');
    assert.ok([f.button, f.left, f.right].every(button => !button.disabled));
    assert.equal(f.animations.size, 0);
  }
});

test('rotation and webcam failures clear the active spinner and unlock all three actions', async () => {
  for (const failRobot of [true, false]) {
    const f = await fixture({ failRobot, failCapture: !failRobot });
    await f.context.updateWebcam(f.doc, f.widget, 'left');
    assert.equal(f.requests.length, failRobot ? 1 : 3);
    assert.equal(f.message.textContent, failRobot ? 'Robot disabled' : 'Camera disconnected');
    assert.equal(f.leftSpinner.textContent, '');
    assert.equal(f.image.src, '/webcam/current.jpg?t=old');
    assert.ok([f.button, f.left, f.right].every(button => !button.disabled));
    assert.equal(f.animations.size, 0);
  }
});

test('each action owns its spinner and blocks the other actions through capture completion', async () => {
  for (const direction of [undefined, 'left', 'right']) {
    const f = await fixture({ holdCapture: true, holdRotation: true, prompts: ['another-page'] });
    const activeSpinner = direction === 'left' ? f.leftSpinner : direction === 'right' ? f.rightSpinner : f.spinner;
    const action = f.context.updateWebcam(f.doc, f.widget, direction);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(activeSpinner.textContent, '|');
    if (direction) {
      assert.equal(f.requests.length, 1);
      await f.context.updateWebcam(f.doc, f.widget);
      await f.context.updateWebcam(f.doc, f.widget, direction === 'left' ? 'right' : 'left');
      assert.equal(f.requests.length, 1);
      f.waits.shift()();
      await new Promise(resolve => setImmediate(resolve));
    }
    const count = f.requests.length;
    assert.equal(f.requests.at(-1).url, '/api/webcam/capture');
    for (const other of [undefined, 'left', 'right']) await f.context.updateWebcam(f.doc, f.widget, other);
    assert.equal(f.requests.length, count);
    assert.ok([f.button, f.left, f.right].every(button => button.disabled));
    f.animations.values().next().value();
    assert.equal(activeSpinner.textContent, '/');
    for (const spinner of [f.spinner, f.leftSpinner, f.rightSpinner]) {
      if (spinner !== activeSpinner) assert.equal(spinner.textContent, '');
    }
    f.context.newPage();
    assert.equal(f.routes[0], '/edit/another-page');
    f.releaseCapture();
    await action;
    assert.equal(activeSpinner.textContent, '');
    assert.equal(f.animations.size, 0);
    assert.ok([f.button, f.left, f.right].every(button => !button.disabled));
  }
});

test('a homepage rotation click runs rotation and capture through the shared viewer', async () => {
  const f = await fixture();
  f.doc.body = {};
  f.doc.title = 'Home';
  const original = f.doc.querySelectorAll;
  f.doc.querySelectorAll = selector => ['a[href]', '[data-webcam-image]'].includes(selector) ? [] : original(selector);
  f.doc.addEventListener = (type, callback) => { f.doc[type] = callback; };
  f.preview.contentDocument = f.doc;
  f.preview.load();
  let prevented = false;
  f.doc.click({
    preventDefault() { prevented = true; },
    target: { closest: selector => selector === '[data-robot-direction]' ? f.right : null }
  });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(prevented, true);
  assert.deepEqual(f.requests.map(request => request.url), ['/api/robot/right', '/api/robot/stop', '/api/webcam/capture']);
});

test('webcam prompts for a required password, retries, and handles cancellation', async () => {
  const f = await fixture({ requiresPassword: true, prompts: ['secret'] });
  await f.context.updateWebcam(f.doc, f.widget);
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[1].headers['X-Edit-Password'], 'secret');
  assert.equal(f.image.src, '/webcam/current.jpg?t=new');
  const cancelled = await fixture({ requiresPassword: true });
  await cancelled.context.updateWebcam(cancelled.doc, cancelled.widget);
  assert.equal(cancelled.requests.length, 1);
  assert.equal(cancelled.button.disabled, false);
  assert.match(cancelled.label.textContent, /cancelled/);
});

test('capture after rotation retains webcam password handling and cancellation cleanup', async () => {
  for (const prompts of [['secret'], []]) {
    const f = await fixture({ requiresPassword: true, prompts });
    await f.context.updateWebcam(f.doc, f.widget, 'right');
    assert.equal(f.requests[0].url, '/api/robot/right');
    assert.equal(f.requests[1].url, '/api/robot/stop');
    if (f.requests.length === 4) {
      assert.equal(f.requests[3].headers['X-Edit-Password'], 'secret');
      assert.equal(f.image.src, '/webcam/current.jpg?t=new');
    } else {
      assert.equal(f.requests.length, 3);
      assert.equal(f.message.textContent, 'Photo update cancelled.');
    }
    assert.ok([f.button, f.left, f.right].every(button => !button.disabled));
    assert.equal(f.rightSpinner.textContent, '');
    assert.equal(f.spinner.textContent, '');
    assert.equal(f.animations.size, 0);
  }
});

test('page prompt routes to an editor, normalizes spaces, and rejects reserved or invalid names', async () => {
  for (const [name, expected] of [['Chocolate Dolphin', '/edit/chocolate-dolphin'], ['index', undefined], ['../bad', undefined], ['', undefined], [null, undefined]]) {
    const f = await fixture({ prompts: [name] });
    f.context.newPage();
    assert.equal(f.routes[0], expected);
    assert.equal(f.requests.length, 0);
    if (name !== null && !expected) assert.equal(f.alerts.length, 1);
  }
});

test('delegated native click activates webcam and new-page buttons in the viewer', async () => {
  const f = await fixture({ prompts: ['new-page'] });
  f.doc.body = {};
  f.doc.title = 'Test';
  const original = f.doc.querySelectorAll;
  f.doc.querySelectorAll = selector => ['[data-webcam-image]', 'a[href]'].includes(selector) ? [] : original(selector);
  f.doc.addEventListener = (type, handler) => { f.doc[type] = handler; };
  f.preview.contentDocument = f.doc;
  f.preview.load();
  let prevented = 0;
  f.doc.click({ preventDefault() { prevented++; }, target: { closest: selector => selector === '[data-new-page]' ? {} : null } });
  assert.equal(f.routes[0], '/edit/new-page');
  f.button.closest = () => f.widget;
  f.doc.click({ preventDefault() { prevented++; }, target: { closest: selector => selector === '[data-webcam-update]' ? f.button : null } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.requests.length, 1);
  assert.equal(prevented, 2);
});

test('page links target the top window before any click handler runs', async () => {
  const f = await fixture();
  const links = ['/edit/index', 'other-page', '#section'].map(href => ({ getAttribute: () => href }));
  f.preview.contentDocument = {
    body: {}, title: 'Home', addEventListener() {},
    querySelectorAll: selector => selector === 'a[href]' ? links : []
  };
  f.preview.load();
  assert.equal(links[0].href, 'https://thinkpad.club/edit/index');
  assert.equal(links[0].target, '_top');
  assert.equal(links[1].href, 'https://thinkpad.club/other-page');
  assert.equal(links[1].target, '_top');
  assert.equal(links[2].target, undefined);
});
