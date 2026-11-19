"""Answer one browser WebRTC offer and stream the server microphone to it.

Usage: listen.py <ffmpeg input format> <device>   (for example: alsa plughw:1,0)
Reads the browser's offer as one JSON line on stdin, prints the answer as one
JSON line on stdout, then streams until the call fails, closes, or stdin closes.
"""
import asyncio
import json
import sys

from aiortc import RTCPeerConnection, RTCSessionDescription
from aiortc.contrib.media import MediaPlayer


async def main(input_format, device):
    offer = json.loads(sys.stdin.readline())
    pc = RTCPeerConnection()
    done = asyncio.Event()

    @pc.on("connectionstatechange")
    def changed():
        if pc.connectionState in ("failed", "closed"):
            done.set()

    await pc.setRemoteDescription(RTCSessionDescription(offer["sdp"], offer["type"]))
    mic = MediaPlayer(device, format=input_format)
    pc.addTrack(mic.audio)
    await pc.setLocalDescription(await pc.createAnswer())
    print(json.dumps({"sdp": pc.localDescription.sdp, "type": pc.localDescription.type}), flush=True)

    # Node closes stdin (or kills us) to hang up.
    asyncio.get_running_loop().add_reader(sys.stdin, done.set)
    await done.wait()
    mic.audio.stop()
    await pc.close()


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1], sys.argv[2]))
