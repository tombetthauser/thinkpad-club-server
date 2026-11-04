"""Play the webcam's two-tone cue through ALSA (no Python packages needed)."""

import math
import os
import struct
import subprocess
import sys


def main():
    device = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("WEBCAM_SOUND_DEVICE", "plughw:1,0")
    rate = 48000
    audio = bytearray()
    for frequency in (1500, 1000):
        for i in range(rate // 10):
            sample = int(6000 * math.sin(2 * math.pi * frequency * i / rate))
            audio.extend(struct.pack("<hh", sample, sample))
    subprocess.run(
        ["aplay", "-q", "-D", device, "-t", "raw", "-f", "S16_LE", "-r", str(rate), "-c", "2"],
        input=audio, check=True, timeout=3,
    )


if __name__ == "__main__":
    main()
