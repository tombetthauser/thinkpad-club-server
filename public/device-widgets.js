(() => {
  const webcam = document.querySelector('[data-device-webcam]');
  if (webcam) {
    const image = webcam.querySelector('img');
    const button = webcam.querySelector('button');
    const message = webcam.querySelector('[role="status"]');
    let password = '';
    image.addEventListener('error', () => { message.textContent = 'No photo available. Update the webcam to take one.'; });
    button.addEventListener('click', async () => {
      if (button.disabled) return;
      button.disabled = true;
      message.textContent = 'Taking photo…';
      try {
        const capture = () => fetch('/api/webcam/capture', {
          method: 'POST', headers: { 'X-Edit-Password': password }
        });
        let response = await capture();
        if (response.status === 401) {
          const entered = window.prompt('Enter the class password to update the webcam:');
          if (entered === null) {
            message.textContent = 'Photo update cancelled.';
            return;
          }
          password = entered;
          response = await capture();
        }
        if (!response.ok) throw new Error(await response.text());
        const photo = await response.json();
        image.src = photo.url;
        message.textContent = 'Photo updated.';
      } catch (error) {
        message.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });
  }

  const robot = document.querySelector('[data-device-robot]');
  if (!robot) return;
  const controller = crypto.randomUUID();
  const speed = robot.querySelector('[data-device-speed]');
  const message = robot.querySelector('[role="status"]');
  let running = false;
  let sequence = 0;
  async function command(action) {
    const response = await fetch(`/api/robot/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Robot-Controller': controller },
      body: JSON.stringify({ speed: Number(speed.value) }),
      signal: AbortSignal.timeout(450),
      keepalive: true
    });
    if (!response.ok) throw new Error(await response.text());
    message.textContent = action === 'stop' ? 'Stopped' : action;
  }
  async function move(direction) {
    if (running) return;
    running = true;
    const current = ++sequence;
    let error = '';
    try {
      const steps = direction === 'dance' ? 12 : 1;
      for (let step = 0; step < steps && current === sequence; step++) {
        const action = direction === 'dance' ? ['left', 'stop', 'right', 'stop'][step % 4] : direction;
        await command(action);
        if (current !== sequence || (direction === 'dance' && step === 11)) break;
        const delay = direction === 'dance' ? (action === 'stop' ? 100 : 150) : 500;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    } catch (failure) {
      error = failure.message;
    } finally {
      try { await command('stop'); }
      catch (failure) { error = failure.message; }
      running = false;
      if (error) message.textContent = error;
    }
  }
  function stop() {
    sequence++;
    command('stop').catch(error => { message.textContent = error.message; });
  }
  for (const button of robot.querySelectorAll('[data-move]')) {
    button.addEventListener('click', () => move(button.dataset.move));
  }
  robot.querySelector('[data-stop]').addEventListener('click', stop);
  window.addEventListener('blur', stop);
  window.addEventListener('pagehide', stop);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
})();
