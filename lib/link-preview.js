const { createHash } = require('node:crypto');

const escape = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)]
    .map(m => [m[1].toLowerCase(), (m[2] ?? m[3] ?? m[4]).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')]));
}

async function linkPreview(html, { origin, pathname, title, webcam, custom = false }) {
  const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] || '';
  const meta = head.replace(/<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script>/gi, '').match(/<meta\b[^>]*>/gi) || [];
  let image;
  if (custom) {
    for (const tag of meta) {
      const attrs = attributes(tag);
      if ((attrs.property || attrs.name)?.toLowerCase() !== 'og:image' || !attrs.content) continue;
      try {
        const url = new URL(attrs.content, origin);
        if (['https:', 'http:'].includes(url.protocol)) image = url.href;
      } catch {}
      break;
    }
  } else {
    try {
      const photo = await webcam.image();
      if (photo.length >= 3 && photo[0] === 255 && photo[1] === 216 && photo[2] === 255) {
        image = new URL('/webcam/current.jpg?v=' + createHash('sha256').update(photo).digest('hex').slice(0, 16), origin).href;
      }
    } catch { /* No saved photo means no advertised preview image. */ }
  }
  const fields = [
    ['property', 'og:title', title], ['property', 'og:type', 'website'],
    ['property', 'og:url', new URL(pathname, origin).href],
    ['property', 'og:description', ''], ['name', 'description', ''],
    ['name', 'twitter:card', image ? 'summary_large_image' : 'summary'],
    ['name', 'twitter:title', title], ['name', 'twitter:description', '']
  ];
  if (image) fields.push(['property', 'og:image', image], ['name', 'twitter:image', image]);
  const markup = fields.map(([key, name, value]) => `<meta ${key}="${name}" content="${escape(value)}">`).join('\n');
  // Replace conflicting metadata only in the head; leave student scripts/body intact.
  const cleanHead = head.replace(/<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script>|<meta\b[^>]*>/gi, tag => {
    if (!/^<meta\b/i.test(tag)) return tag;
    const a = attributes(tag), key = (a.property || a.name || '').toLowerCase();
    return key.startsWith('og:') || key.startsWith('twitter:') || key === 'description' ? '' : tag;
  });
  if (/<head\b[^>]*>[\s\S]*?<\/head>/i.test(html)) {
    return html.replace(/(<head\b[^>]*>)[\s\S]*?(<\/head>)/i, (_, open, close) => `${open}\n${markup}\n${cleanHead}${close}`);
  }
  const newHead = `<head><title>${escape(title)}</title>\n${markup}\n</head>`;
  if (/<html\b[^>]*>/i.test(html)) return html.replace(/<html\b[^>]*>/i, opening => opening + newHead);
  return html.replace(/^(\s*<!doctype[^>]*>)?/i, opening => opening + newHead);
}

module.exports = { linkPreview };
