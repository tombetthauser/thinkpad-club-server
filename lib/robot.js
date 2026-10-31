const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const path = require('node:path');

const problem = (status, message) => Object.assign(new Error(message), { status });

function robot(options = {}) {
  const enabled = options.enabled ?? process.env.ROBOT_ENABLED === '1';
  let child, ready = false, failed = false, owner, until = 0, state = 'stop', sequence = 0;
  const pending = new Map();
  function request(command) {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, timer: setTimeout(fault, 400) });
      child.stdin.write(JSON.stringify({ ...command, id }) + '\n');
    });
  }
  function fault() {
    if (failed) return;
    ready = false;
    failed = true;
    owner = null;
    state = 'stop';
    for (const command of pending.values()) {
      clearTimeout(command.timer);
      command.reject(problem(503, 'Motor worker unavailable. Check GPIO setup and restart the server.'));
    }
    pending.clear();
    child?.stdin.destroy();
    child?.kill('SIGTERM');
  }
  if (enabled) {
    child = (options.spawn || spawn)(process.env.ROBOT_PYTHON || 'python3',
      ['-u', path.join(__dirname, 'motors.py')], { stdio: ['pipe', 'pipe', 'inherit'] });
    child.on('error', fault);
    child.on('exit', fault);
    child.stdin.on('error', fault);
    createInterface({ input: child.stdout }).on('line', line => {
      try {
        const message = JSON.parse(line);
        if (message.ready && !failed) ready = true;
        const command = pending.get(message.id);
        if (command) {
          clearTimeout(command.timer);
          pending.delete(message.id);
          if (message.error) command.reject(problem(400, message.error));
          else command.resolve(message.steps);
        }
      } catch { fault(); }
    });
    const startup = setTimeout(() => { if (!ready) fault(); }, 5000);
    startup.unref();
  }
  return {
    status() {
      if (Date.now() >= until) { owner = null; state = 'stop'; }
      return { enabled, ready, state, maxSpeed: .6, timeoutMs: 500 };
    },
    async program(code) {
      if (!enabled || !ready) throw problem(503, 'Robot disabled or GPIO worker unavailable.');
      if (typeof code !== 'string' || !code.trim() || Buffer.byteLength(code) > 4096) {
        throw problem(400, 'Write a program of up to 4096 bytes.');
      }
      if (pending.size) throw problem(409, 'A motor command is still pending.');
      return request({ code });
    },
    async command(action, speed, controller) {
      if (!enabled || !ready) throw problem(503, 'Robot disabled or GPIO worker unavailable.');
      this.status();
      if (pending.size && action !== 'stop') throw problem(409, 'A motor command is still pending.');
      if (!['forward', 'backward', 'left', 'right', 'stop', 'wheels'].includes(action)) throw problem(400, 'Unknown motor command.');
      if (action !== 'stop' && owner && owner !== controller) throw problem(409, 'Another controller is driving.');
      const validSpeed = action === 'wheels'
        ? Array.isArray(speed) && speed.length === 2 && speed.every(value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= .6)
        : typeof speed === 'number' && Number.isFinite(speed) && speed >= 0 && speed <= .6;
      if (action !== 'stop' && !validSpeed) {
        throw problem(400, 'Speed must be a number from 0 to 0.6.');
      }
      const expires = Date.now() + 500;
      const id = sequence + 1;
      await request({ action, speed, expires: expires / 1000 });
      if (id === sequence) {
        owner = action === 'stop' ? null : controller;
        until = action === 'stop' ? 0 : expires;
        state = action;
      }
      return this.status();
    },
    close() { fault(); }
  };
}
module.exports = { robot };
