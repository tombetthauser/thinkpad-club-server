const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

async function playbackFixture({ holdPlay = false, failStop = false } = {}) {
  const nodes = Object.fromEntries(["status", "play-server", "play-browser", "search", "sections"].map(id => [id, {
    value: "", checked: false, append() {}, replaceChildren() {},
    addEventListener(type, callback) { this[type] = callback; }
  }]));
  const requests = [], sounds = [];
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const context = vm.createContext({
    document: { getElementById: id => nodes[id] },
    Audio: class {
      constructor(url) { this.url = url; this.playing = false; sounds.push(this); }
      async play() { this.playing = true; }
      pause() { this.playing = false; }
    },
    fetch: async url => {
      requests.push(url);
      if (holdPlay && url === "/api/arnold/play") await waiting;
      return { ok: !(failStop && url.endsWith("/stop")), text: async () => "Stop failed", json: async () => [] };
    }
  });
  const html = fs.readFileSync(path.join(__dirname, "../public/arnold.html"), "utf8");
  // Simulate a browser restoring stale checkbox values before scripts execute.
  nodes['play-server'].checked = false;
  nodes['play-browser'].checked = true;
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  await new Promise(resolve => setImmediate(resolve));
  requests.length = 0;
  return { nodes, requests, sounds, release, play: () => vm.runInContext('play({name:"Hello", file:"secondary/hello.mp3"})', context) };
}

test("outputs default to server only and switching to browser only stops the server", async () => {
  const f = await playbackFixture();
  assert.equal(f.nodes['play-server'].checked, true);
  assert.equal(f.nodes['play-browser'].checked, false);
  await f.play();
  assert.deepEqual(f.requests, ["/api/arnold/play"]);
  assert.equal(f.sounds.length, 0);
  f.nodes["play-server"].checked = false;
  f.nodes["play-browser"].checked = true;
  await f.nodes["play-browser"].change();
  f.requests.length = 0;
  await f.play();
  assert.deepEqual(f.requests, ["/api/arnold/stop"]);
  assert.equal(f.sounds[0].playing, true);
  f.nodes["play-server"].checked = true;
  f.nodes["play-browser"].checked = false;
  const switching = f.nodes["play-browser"].change();
  assert.equal(f.sounds[0].playing, false);
  await switching;
  await f.play();
  assert.equal(f.requests.at(-1), "/api/arnold/play");
  assert.equal(f.sounds.length, 1);
});

test("both checked plays both destinations; both unchecked plays neither", async () => {
  const f = await playbackFixture();
  f.nodes['play-browser'].checked = true;
  await f.nodes['play-browser'].change();
  f.requests.length = 0;
  await f.play();
  assert.deepEqual(f.requests, ['/api/arnold/play']);
  assert.equal(f.sounds.length, 1);
  assert.equal(f.sounds[0].playing, true);
  f.nodes['play-server'].checked = false;
  f.nodes['play-browser'].checked = false;
  await f.nodes['play-server'].change();
  assert.equal(f.sounds[0].playing, false);
  f.requests.length = 0;
  await f.play();
  assert.deepEqual(f.requests, ['/api/arnold/stop']);
  assert.equal(f.sounds.length, 1);
  assert.match(f.nodes.status.textContent, /Select a playback destination/);
});

test("switching during an in-flight server play stops it before browser audio starts", async () => {
  const f = await playbackFixture({ holdPlay: true });
  const first = f.play();
  await new Promise(resolve => setImmediate(resolve));
  f.nodes["play-server"].checked = false;
  f.nodes["play-browser"].checked = true;
  const switching = f.nodes["play-browser"].change();
  const second = f.play();
  assert.equal(f.sounds.length, 0);
  f.release();
  await Promise.all([first, switching, second]);
  assert.deepEqual(f.requests, ["/api/arnold/play", "/api/arnold/stop", "/api/arnold/stop"]);
  assert.equal(f.sounds.length, 1);
  assert.equal(f.sounds[0].playing, true);
});

test("browser playback does not start if stopping the server fails", async () => {
  const f = await playbackFixture({ failStop: true });
  f.nodes["play-server"].checked = false;
  f.nodes["play-browser"].checked = true;
  await f.play();
  assert.equal(f.sounds.length, 0);
  assert.match(f.nodes.status.textContent, /Playback failed/);
});

test("Arnold renders every clip once in section order and searches names, files, and sections", async () => {
  function element() {
    return {
      value: "", children: [],
      setAttribute(name, value) { this[name] = value; },
      append(...children) { this.children.push(...children); },
      replaceChildren() { this.children = []; },
      addEventListener(type, callback) { this[type] = callback; }
    };
  }
  const nodes = Object.fromEntries(["status", "play-server", "play-browser", "search", "sections"].map(id => [id, element()]));
  const clips = JSON.parse(fs.readFileSync(path.join(__dirname, "../assets/audio/arnold-realm/manifest.json"))).clips;
  const html = fs.readFileSync(path.join(__dirname, "../public/arnold.html"), "utf8");
  vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], {
    document: { getElementById: id => nodes[id], createElement: element },
    fetch: async () => ({ ok: true, json: async () => clips })
  });
  await new Promise(resolve => setImmediate(resolve));
  const sections = () => nodes.sections.children;
  const names = () => sections().flatMap(section => section.children[0].children.map(button => button.textContent));
  assert.equal(sections().length, 16);
  assert.equal(sections()[0]['aria-label'], "Greetings & conversation starters");
  assert.equal(sections().at(-1)['aria-label'], "Conversation enders & stepping away");
  assert.equal(names().length, 428);
  assert.deepEqual(names(), clips.map(c => c.name));
  nodes.search.value = "who is your daddy";
  nodes.search.input();
  assert.equal(sections().length, 1);
  assert.equal(sections()[0]['aria-label'], "Questions");
  nodes.search.value = "choppa";
  nodes.search.input();
  assert.equal(names().length, 2);
  nodes.search.value = "conversation enders";
  nodes.search.input();
  assert.equal(sections().length, 1);
  assert.equal(names().length, clips.filter(c => c.section === "enders").length);
  nodes.search.value = "not-a-real-clip";
  nodes.search.input();
  assert.equal(sections().length, 0);
  assert.equal(nodes.status.textContent, "0 of 428 sounds");
});
