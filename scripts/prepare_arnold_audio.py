#!/usr/bin/env python3
"""Prepare PCM WAV sidecars for the Pi's existing aplay speaker setup.

Run on a development machine with ffmpeg, then deploy the WAVs with the MP3s.
The Pi only needs alsa-utils, just like the webcam beeps. MP3s remain for browsers.
"""
import json
import subprocess
import wave
from pathlib import Path

DIRECTORY = Path(__file__).resolve().parent.parent / 'assets/audio/arnold-realm'


def main():
    clips = json.loads((DIRECTORY / 'manifest.json').read_text())['clips']
    for clip in clips:
        if clip['status'] == 'failed':
            continue
        source = DIRECTORY / clip['file']
        target = source.with_suffix('.wav')
        if not target.exists() or target.stat().st_mtime < source.stat().st_mtime:
            temporary = target.with_suffix('.part.wav')
            subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-i', str(source),
                            '-c:a', 'pcm_s16le', str(temporary)], check=True)
            temporary.replace(target)
        with wave.open(str(target), 'rb') as audio:
            if audio.getsampwidth() != 2 or audio.getnframes() == 0:
                raise ValueError(f'Invalid PCM audio: {target}')
    print(f'Prepared {len(clips)} WAV files for aplay.')


if __name__ == '__main__':
    main()
