const { spawn } = require('node:child_process');
const { pipeline } = require('node:stream');
const problem = (status, message) => Object.assign(new Error(message), { status });

function videoURL(input) {
  let url;
  try { url = new URL(input); } catch { throw problem(400, 'Paste a YouTube video URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) throw problem(400, 'Use a YouTube video URL.');
  let id;
  if (url.hostname === 'youtu.be') id = url.pathname.slice(1);
  else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(url.hostname)) {
    id = url.pathname === '/watch' ? url.searchParams.get('v') : /^\/(?:shorts|live|embed)\/([^/]+)\/?$/.exec(url.pathname)?.[1];
  }
  if (!/^[\w-]{11}$/.test(id || '')) throw problem(400, 'Paste a single YouTube video URL, not a playlist or another website.');
  return `https://www.youtube.com/watch?v=${id}`;
}

function youtube({ audio, spawn: start = spawn, maxMs = 10 * 60 * 1000, platform = process.platform } = {}) {
  let current = null;
  let lastError = '';
  function stop(controller, admin = false) {
    if (!current) return;
    if (!admin && current.controller !== controller) throw problem(403, 'Only the person who started this audio can stop it.');
    current.cancel();
  }
  return {
    status: () => ({ playing: !!current, url: current?.url || '', error: lastError, maxSeconds: Math.floor(maxMs / 1000) }),
    stop,
    async play(input, controller) {
      const url = videoURL(input);
      const release = audio.acquireStream(); // Synchronous: no other request can slip in during startup.
      lastError = '';
      const children = [];
      const closed = new Set();
      let ending = false, timer, startupTimer;
      const job = { controller, url, cancel: () => finish() };
      current = job;
      let rejectReady;
      let ready = false;
      function releaseIfClosed() {
        if (closed.size !== children.length) return;
        clearTimeout(timer);
        clearTimeout(startupTimer);
        if (current === job) current = null;
        release();
      }
      function finish(message = '') {
        if (ending) return;
        ending = true;
        if (message) lastError = message;
        if (!ready && rejectReady) rejectReady(problem(message ? 503 : 409, message || 'Playback was stopped.'));
        for (const child of children) child.kill();
        const force = setTimeout(() => { for (const child of children) if (!closed.has(child)) child.kill('SIGKILL'); }, 1000);
        force.unref();
        releaseIfClosed();
      }
      try {
        const commands = [
          [process.env.YTDLP_BIN || 'yt-dlp', ['--ignore-config', '--no-playlist', '--no-cache-dir', '--no-part', '--no-progress', '--js-runtimes', `node:${process.execPath}`, '--socket-timeout', '15', '--retries', '1', '-f', 'bestaudio[protocol=https]/best[protocol=https]', '-o', '-', '--', url]],
          ['ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-vn', '-t', String(maxMs / 1000), '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1']],
          platform === 'darwin'
            ? ['ffplay', ['-nodisp', '-autoexit', '-loglevel', 'error', '-f', 's16le', '-sample_rate', '48000', '-ch_layout', 'stereo', '-i', 'pipe:0']]
            : ['aplay', ['-q', '-D', process.env.WEBCAM_SOUND_DEVICE || 'plughw:1,0', '-t', 'raw', '-f', 'S16_LE', '-r', '48000', '-c', '2']]
        ];
        await new Promise((resolve, reject) => {
          rejectReady = reject;
          let spawned = 0, decoded = false;
          const started = () => {
            if (ending || spawned !== 3 || !decoded) return;
            ready = true;
            clearTimeout(startupTimer);
            resolve();
          };
          for (const [command, args] of commands) {
            if (ending) break;
            const child = start(command, args, { stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
            children.push(child);
            audio.track(child);
            child.once('spawn', () => { spawned++; started(); });
            child.once('error', error => finish(`Could not start ${command}: ${error.code === 'ENOENT' ? 'install the YouTube audio dependencies on the server' : error.message}.`));
            child.once('close', code => {
              closed.add(child);
              if (!ending && code) finish(`${command} could not play this video. Check the service logs and try another video.`);
              if (!ending && child === children[2]) finish();
              releaseIfClosed();
            });
            child.stderr.on('data', data => console.warn(`${command}: ${data.toString().trim().slice(0, 2000)}`));
          }
          if (children.length !== 3 || ending) return;
          // Wait until decoded audio exists; extraction failures are returned to the caller.
          children[1].stdout.once('data', () => { decoded = true; started(); });
          pipeline(children[0].stdout, children[1].stdin, error => { if (error && !ending) finish('YouTube audio streaming was interrupted.'); });
          pipeline(children[1].stdout, children[2].stdin, error => { if (error && !ending) finish('Speaker audio streaming was interrupted.'); });
          children[2].stdout.resume();
          startupTimer = setTimeout(() => finish('YouTube took too long to start. Try another video.'), 45000);
          timer = setTimeout(() => finish('Playback reached the 10-minute limit.'), maxMs);
          startupTimer.unref(); timer.unref();
        });
        return { playing: true, url };
      } catch (error) {
        finish(error.message);
        throw error.status ? error : problem(503, 'Could not start YouTube audio. Check the server dependencies.');
      }
    }
  };
}
module.exports = { youtube, videoURL };
