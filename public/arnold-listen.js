// Hear the server microphone over WebRTC. The server answers one offer at a time.
(() => {
  const button = document.getElementById('listen');
  const message = document.getElementById('listen-status');
  const speaker = document.getElementById('listen-audio');
  let pc = null;
  let password = '';

  function stop(text = 'Not listening.') {
    if (pc) {
      pc.close();
      fetch('/api/arnold/listen/stop', { method: 'POST' }).catch(() => {});
    }
    pc = null;
    speaker.srcObject = null;
    button.textContent = 'Start listening';
    message.textContent = text;
  }

  async function start() {
    const call = pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    button.textContent = 'Stop listening';
    message.textContent = 'Connecting…';
    call.addTransceiver('audio', { direction: 'recvonly' });
    call.ontrack = event => {
      speaker.srcObject = event.streams[0] || new MediaStream([event.track]);
      speaker.play().catch(() => {});
    };
    call.onconnectionstatechange = () => {
      if (pc !== call) return;
      if (call.connectionState === 'connected') message.textContent = 'Listening to the server microphone.';
      if (call.connectionState === 'failed') stop('Connection failed. The server may be unreachable for audio.');
    };
    await call.setLocalDescription(await call.createOffer());
    // Send every ICE candidate in the offer instead of trickling them.
    await new Promise(resolve => {
      if (call.iceGatheringState === 'complete') return resolve();
      call.addEventListener('icegatheringstatechange', () => { if (call.iceGatheringState === 'complete') resolve(); });
      setTimeout(resolve, 3000);
    });
    const send = () => fetch('/api/arnold/listen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Edit-Password': password },
      body: JSON.stringify(call.localDescription)
    });
    let response = await send();
    if (response.status === 401) {
      const entered = window.prompt('Enter the class password to listen:');
      if (entered === null) return stop('Listening cancelled.');
      password = entered;
      response = await send();
    }
    if (!response.ok) throw new Error(await response.text());
    const answer = await response.json();
    if (pc === call) await call.setRemoteDescription(answer);
  }

  button.addEventListener('click', () => {
    if (pc) return stop();
    start().catch(error => stop('Could not listen: ' + error.message));
  });
  window.addEventListener('pagehide', () => { if (pc) navigator.sendBeacon('/api/arnold/listen/stop'); });
})();
