const path = require('node:path');
const { spawn } = require('node:child_process');

const problem = (status, message) => Object.assign(new Error(message), { status });

// One listener at a time: a new call hangs up the previous one.
function listen(options = {}) {
  const platform = options.platform || process.platform;
  const format = options.format || process.env.ARNOLD_MIC_FORMAT || (platform === 'darwin' ? 'avfoundation' : 'alsa');
  const device = options.device || process.env.ARNOLD_MIC_DEVICE || (platform === 'darwin' ? ':0' : 'plughw:1,0');
  const python = options.python || process.env.ARNOLD_LISTEN_PYTHON || 'python3';
  const start = options.spawn || spawn;
  let current = null;

  function stop() {
    if (current) current.kill();
    current = null;
  }

  function answer(offer) {
    stop();
    const child = start(python, [path.join(__dirname, 'listen.py'), format, device], { stdio: ['pipe', 'pipe', 'inherit'] });
    current = child;
    return new Promise((resolve, reject) => {
      let output = '';
      const fail = message => {
        clearTimeout(timer);
        if (current === child) stop();
        reject(problem(503, message));
      };
      const timer = setTimeout(() => fail('The server microphone did not answer in time.'), 15000);
      child.once('error', error => {
        console.warn('Listener failed:', error.message);
        fail(`Could not start ${python}. Install aiortc for the listener (see README).`);
      });
      child.once('exit', code => {
        if (current === child) current = null;
        fail(`The server microphone stopped (exit ${code}). Check ARNOLD_MIC_DEVICE and the aiortc install.`);
      });
      child.stdout.on('data', chunk => {
        output += chunk;
        if (!output.includes('\n')) return;
        clearTimeout(timer);
        try { resolve(JSON.parse(output.split('\n')[0])); }
        catch { fail('The server microphone sent a bad answer.'); }
      });
      child.stdin.on('error', () => {});
      child.stdin.write(JSON.stringify(offer) + '\n');
    });
  }

  return { answer, stop };
}

module.exports = { listen };
