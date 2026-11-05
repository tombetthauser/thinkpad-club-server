const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);

function beep(options = {}) {
  const run = options.run || execute;
  let playing = false;
  return {
    async play() {
      if (playing) throw Object.assign(new Error('A beep is already playing.'), { status: 409 });
      playing = true;
      try {
        await run('python3', [path.join(__dirname, 'beep-1-up.py'), process.env.WEBCAM_SOUND_DEVICE || 'plughw:1,0'], { timeout: 5000, maxBuffer: 65536 });
      } catch (error) {
        console.warn('Server beep failed:', error.message);
        throw Object.assign(new Error('Could not play the server beep. Check the speaker and audio setup.'), { status: 503 });
      } finally {
        playing = false;
      }
    }
  };
}
module.exports = { beep };
