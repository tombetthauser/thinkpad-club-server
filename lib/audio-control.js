const problem = (status, message) => Object.assign(new Error(message), { status });

function audioControl() {
  let enabled = true;
  let stream = false;
  const children = new Set();
  function assertAvailable() {
    if (!enabled) throw problem(503, 'Server audio is disabled by the administrator.');
    if (stream) throw problem(409, 'Someone is already playing audio. Try again when it finishes.');
  }
  function kill(child, signal = 'SIGTERM') {
    try {
      if (child.pid && process.platform !== 'win32') process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch (error) {
      if (error.code !== 'ESRCH') child.kill(signal);
    }
  }
  function stopAll() {
    for (const child of children) {
      kill(child);
      const timer = setTimeout(() => { if (children.has(child)) kill(child, 'SIGKILL'); }, 1000);
      timer.unref();
    }
  }
  return {
    status: () => ({ enabled, busy: stream || children.size > 0 }),
    assertAvailable,
    canPlay: () => enabled && !stream,
    track(child) {
      if (!child) return;
      children.add(child);
      const remove = () => children.delete(child);
      child.once('close', remove);
      child.once('error', remove);
      if (!enabled) kill(child);
    },
    acquireStream() {
      assertAvailable();
      if (children.size) throw problem(409, 'Someone is already playing audio. Try again when it finishes.');
      stream = true;
      let released = false;
      return () => { if (!released) { stream = false; released = true; } };
    },
    setEnabled(value) { enabled = value; if (!enabled) stopAll(); },
    stopAll
  };
}
module.exports = { audioControl };
