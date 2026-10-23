/* Credentials and controller identity live only in this page's memory. */
const $ = id => document.getElementById(id);
const controller = crypto.randomUUID();
let password = '', active = null, timer, inFlight = false, generation = 0;

async function request(action, body) {
  const response = await fetch(`/api/robot/${action}`, {
    method: body ? 'POST' : 'GET', cache: 'no-store',
    headers: { 'X-Robot-Password': password, 'X-Robot-Controller': controller, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(450), keepalive: Boolean(body)
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

function stop() {
  active = null;
  generation++;
  clearTimeout(timer);
  $('status').textContent = 'Stopping…';
  // If a move is pending, tick sends stop after it completes to preserve ordering.
  if (!inFlight && password) sendStop();
}

async function sendStop() {
  inFlight = true;
  try {
    await request('stop', {});
    $('status').textContent = 'Stopped';
  } catch (error) {
    $('status').textContent = `${error.message} Movement expires within 500 ms.`;
    $('controls').disabled = true;
  } finally { inFlight = false; }
}

async function tick() {
  if (!active || inFlight) return;
  inFlight = true;
  const current = generation;
  try {
    const state = await request(active.action, { speed: Number($('speed').value) });
    if (current === generation) $('status').textContent = `Command: ${state.state} (no wheel feedback)`;
  } catch (error) {
    active = null;
    generation++;
    $('controls').disabled = true;
    $('status').textContent = `${error.message} Movement expires within 500 ms.`;
  } finally {
    inFlight = false;
    if (!active || current !== generation) await sendStop();
    else timer = setTimeout(tick, 120);
  }
}

function start(action, source) {
  if ($('controls').disabled || active || inFlight) return;
  active = { action, source };
  generation++;
  tick();
}

$('connect').onclick = async () => {
  stop();
  password = $('password').value;
  try {
    const state = await request('status');
    if (!state.ready) throw new Error('Robot disabled or GPIO worker unavailable.');
    $('controls').disabled = false;
    $('status').textContent = 'Ready — hold a direction to move';
  } catch (error) { $('status').textContent = error.message; }
};
$('password').addEventListener('input', () => { stop(); $('controls').disabled = true; });
$('stop').onclick = stop;
$('speed').oninput = () => { $('speed-value').textContent = `${Math.round($('speed').value * 100)}%`; };
for (const button of document.querySelectorAll('[data-direction]')) {
  button.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    start(button.dataset.direction, event.pointerId);
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    button.addEventListener(name, event => { if (active?.source === event.pointerId) stop(); });
  }
}
const keys = { ArrowUp: 'forward', ArrowDown: 'backward', ArrowLeft: 'left', ArrowRight: 'right' };
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' || (event.code === 'Space' && event.target.tagName !== 'INPUT')) {
    event.preventDefault(); stop(); return;
  }
  if (event.target.matches('input, textarea, select') || !keys[event.key]) return;
  event.preventDefault();
  if (!event.repeat) start(keys[event.key], event.key);
});
document.addEventListener('keyup', event => { if (active?.source === event.key) stop(); });
window.addEventListener('blur', stop);
window.addEventListener('pagehide', stop);
document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
