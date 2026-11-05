(() => {
  const controller = crypto.randomUUID();
  const url = document.getElementById('youtube-url');
  const play = document.getElementById('youtube-play');
  const stop = document.getElementById('youtube-stop');
  const message = document.getElementById('youtube-status');
  let pending = false;
  let owned = false;
  async function command(action) {
    const response = await fetch('/api/youtube/' + action, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Audio-Controller': controller },
      body: JSON.stringify({ url: url.value })
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  }
  play.addEventListener('click', async () => {
    if (pending) return;
    pending = true;
    play.disabled = true;
    message.textContent = 'Starting YouTube audio…';
    try {
      await command('play');
      owned = true;
      message.textContent = 'Playing on server.';
    } catch (error) { message.textContent = error.message; }
    finally { pending = false; play.disabled = false; }
  });
  stop.addEventListener('click', async () => {
    stop.disabled = true;
    try { await command('stop'); owned = false; message.textContent = 'Stopped.'; }
    catch (error) { message.textContent = error.message; }
    finally { stop.disabled = false; }
  });
  async function refresh() {
    try {
      const response = await fetch('/api/hardware/status');
      if (!response.ok) return;
      const state = await response.json();
      if (pending) return;
      if (!state.audio.enabled) message.textContent = 'Server audio is disabled by the administrator.';
      else if (state.youtube.playing) message.textContent = owned ? 'Playing on server.' : 'Server audio is busy.';
      else if (owned) { owned = false; message.textContent = state.youtube.error || 'Playback finished.'; }
    } catch { /* Keep the last useful message during a brief network failure. */ }
  }
  refresh();
  setInterval(refresh, 2000);
})();
