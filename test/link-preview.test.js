const { test } = require('node:test');
const assert = require('node:assert/strict');
const { linkPreview } = require('../lib/link-preview');
const context = { origin: 'https://thinkpad.club', pathname: '/demo', title: 'demo' };

test('built-in previews use the saved webcam photo and change its URL when the photo changes', async () => {
  const html = '<html><head><meta property="og:image" content="old.jpg"></head><body>Hi</body></html>';
  const render = byte => linkPreview(html, { ...context, webcam: { image: async () => Buffer.from([255,216,255,byte]) } });
  const first = await render(1), second = await render(2);
  assert.match(first, /property="og:image" content="https:\/\/thinkpad.club\/webcam\/current.jpg\?v=[a-f0-9]+"/);
  assert.notEqual(first, second);
  assert.doesNotMatch(first, /old.jpg/);
});

test('missing webcam omits image metadata and never captures a new photo', async () => {
  const html = await linkPreview('<h1>Camera</h1>', { ...context, webcam: {
    image: async () => { throw new Error('No photo'); }, capture() { throw new Error('Must not capture'); }
  } });
  assert.doesNotMatch(html, /og:image|twitter:image/);
});

test('student preview uses the slug with no automatic image and preserves custom page code', async () => {
  const script = '<script>const example = \'<meta property="og:image" content="fake.jpg">\';</script>';
  const original = `<html><head><title>My fancy title</title>${script}</head><body><img src="/webcam/current.jpg"></body></html>`;
  const html = await linkPreview(original, { ...context, custom: true });
  assert.match(html, /og:title" content="demo"/);
  assert.match(html, /<title>My fancy title<\/title>/);
  assert.ok(html.includes(script));
  assert.doesNotMatch(html, /<meta property="og:image" content="https:/);
});

test('student og:image URLs are resolved absolutely, escaped, and unsafe schemes omitted', async () => {
  const html = await linkPreview('<html><head><meta content="/uploads/photo.png" property="og:image"></head></html>', { ...context, custom: true });
  assert.match(html, /og:image" content="https:\/\/thinkpad.club\/uploads\/photo.png"/);
  const invalid = await linkPreview('<head><meta property="og:image" content="javascript:alert(1)"></head>', { ...context, custom: true });
  assert.doesNotMatch(invalid, /og:image|javascript:/);
});
