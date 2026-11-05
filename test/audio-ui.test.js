const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const settle = () => new Promise(resolve => setImmediate(resolve));
const element = extra => ({ value: '', ...extra, addEventListener(type, handler) { this[type] = handler; } });

test('YouTube form sends one request at a time and shows busy errors without retrying', async () => {
  const nodes = Object.fromEntries(['youtube-url', 'youtube-play', 'youtube-stop', 'youtube-status'].map(id => [id, element()]));
  nodes['youtube-url'].value = 'https://youtu.be/BaW_jenozKc';
  const requests = [];
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/youtube-player.js'), 'utf8'), {
    document: { getElementById: id => nodes[id] }, crypto: { randomUUID: () => 'controller' }, setInterval() {},
    fetch: async (url, options) => {
      if (url.endsWith('/status')) return { ok: true, json: async () => ({ audio: { enabled: true }, youtube: { playing: false } }) };
      requests.push({ url, options });
      if (url.endsWith('/play')) { await waiting; return { ok: false, text: async () => 'Someone is already playing audio.' }; }
      return { ok: true, json: async () => ({ stopped: true }) };
    }
  });
  const starting = nodes['youtube-play'].click();
  await nodes['youtube-play'].click();
  assert.equal(requests.length, 1);
  assert.equal(nodes['youtube-play'].disabled, true);
  assert.equal(JSON.parse(requests[0].options.body).url, nodes['youtube-url'].value);
  release(); await starting;
  assert.match(nodes['youtube-status'].textContent, /already playing/);
  assert.equal(nodes['youtube-play'].disabled, false);
  await nodes['youtube-stop'].click();
  assert.equal(requests.at(-1).url, '/api/youtube/stop');
});

test('admin buttons send explicit enable/disable values and display current state without a password', async () => {
  const nodes = Object.fromEntries(['audio-state', 'movement-state', 'message'].map(id => [id, element()]));
  const buttons = ['audio', 'movement'].flatMap(control => ['false', 'true'].map(enabled => element({ dataset: { control, enabled } })));
  const state = { audio: { enabled: true, busy: false }, movement: { enabled: true } };
  const requests = [];
  const html = fs.readFileSync(require.resolve('../public/admin.html'), 'utf8');
  vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], {
    document: { getElementById: id => nodes[id], querySelectorAll: () => buttons }, setInterval() {},
    fetch: async (url, options) => {
      if (options) {
        const body = JSON.parse(options.body); requests.push(body);
        state[body.control].enabled = body.enabled;
      }
      return { ok: true, json: async () => state };
    }
  });
  await settle();
  assert.match(nodes['audio-state'].textContent, /enabled/);
  await buttons[0].click();
  assert.deepEqual(requests[0], { control: 'audio', enabled: false });
  assert.match(nodes['audio-state'].textContent, /disabled/);
  await buttons[1].click();
  assert.match(nodes['audio-state'].textContent, /enabled/);
  await buttons[2].click();
  assert.match(nodes['movement-state'].textContent, /disabled/);
  assert.ok(buttons.every(button => button.disabled === false));
});
