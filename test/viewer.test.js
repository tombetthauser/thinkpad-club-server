const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const vm = require('node:vm');
const path = require('node:path');

async function fixture({ failCapture = false, requiresPassword = false, prompts = [] } = {}) {
  const requests = [];
  const routes = [];
  const alerts = [];
  const preview = { addEventListener(type, fn) { this[type] = fn; } };
  const context = vm.createContext({
    URL, setInterval, clearInterval,
    location: { pathname: '/', href: 'https://thinkpad.club/', assign: url => routes.push(url) },
    document: { getElementById: () => preview },
    window: { prompt: () => prompts.shift() ?? null, alert: message => alerts.push(message) },
    fetch: async (url, options) => {
      requests.push({ url, ...options });
      const unauthorized = requiresPassword && options.headers['X-Edit-Password'] !== 'secret';
      return {
        status: unauthorized ? 401 : failCapture ? 503 : 200,
        ok: !unauthorized && !failCapture,
        text: async () => unauthorized ? 'Password required' : 'Camera disconnected',
        json: async () => ({ url: '/webcam/current.jpg?t=new' })
      };
    }
  });
  vm.runInContext(await fs.readFile(path.join(__dirname, '../public/viewer.js'), 'utf8'), context);
  const button = { disabled: false };
  const image = { src: '/webcam/current.jpg?t=old', hidden: false };
  const label = { textContent: '' };
  const spinner = { textContent: '' };
  const doc = { querySelectorAll: selector => ({
    '[data-webcam-update]': [button], '[data-webcam-image]': [image], '[data-webcam-status]': [label]
  })[selector] };
  return { context, preview, requests, routes, alerts, button, image, label, doc, widget: { querySelector: selector => selector === "[data-webcam-spinner]" ? spinner : label } };
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
