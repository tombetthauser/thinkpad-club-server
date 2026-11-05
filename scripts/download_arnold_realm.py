#!/usr/bin/env python3
"""Download the public Realm of Darkness main Arnold board into a separate folder.

Run: python3 scripts/download_arnold_realm.py [--out DIR] [--delay SECONDS]
Existing audio is skipped. A manifest records source URLs and failed downloads.
"""
import argparse
import html
import json
import re
import time
from pathlib import Path

from download_arnold import fetch, is_audio

ROOT = "https://www.realmofdarkness.net"
BOARD = ROOT + "/sb/arnold/"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=Path(__file__).resolve().parent.parent / "assets/audio/arnold-realm")
    parser.add_argument("--delay", type=float, default=0.3)
    args = parser.parse_args()
    if args.delay < 0:
        parser.error("--delay must be nonnegative")
    page = fetch(BOARD)[0].decode("utf-8")
    sound_list = fetch(ROOT + "/scripts/sb/arnold/main/sounds.js")[0].decode("utf-8")
    stop_ids = {"1-st", "1-st-a", "1-st-b", "1-st-c"}
    ids = [sound for sound in dict.fromkeys(re.findall(r'"([a-zA-Z0-9_-]+)"', sound_list)) if sound not in stop_ids]
    if not ids:
        raise RuntimeError("No sound IDs found; the board may have changed.")
    labels = dict(re.findall(r'<button\b[^>]*\bid="([^"]+)"[^>]*>(.*?)</button>', page, re.S))
    args.out.mkdir(parents=True, exist_ok=True)
    manifest_path = args.out / "manifest.json"
    previous = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    existing = {c["source_url"]: c for c in previous.get("clips", [])}
    clips = []
    stats = {"downloaded": 0, "skipped": 0, "failed": 0}

    def save():
        temporary = args.out / "manifest.json.part"
        temporary.write_text(json.dumps({**previous, "board": BOARD, "stats": stats, "clips": clips}, indent=2) + "\n")
        temporary.replace(args.out / "manifest.json")

    print(f"Found {len(ids)} clips; saving to {args.out}", flush=True)
    for index, sound in enumerate(ids, 1):
        filename = sound + ".mp3"
        url = ROOT + "/audio/arnold/main/" + filename
        saved = existing.get(url, {})
        relative = Path(saved.get("file", filename))
        if relative.is_absolute() or ".." in relative.parts:
            raise ValueError(f"Unsafe manifest filename: {relative}")
        target = args.out / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        name = html.unescape(re.sub(r"<[^>]+>", "", labels.get(sound, sound))).strip()
        entry = {**saved, "name": saved.get("name", name), "file": str(relative), "source_url": url, "page_url": BOARD}
        try:
            if target.exists() and is_audio(target.read_bytes()) == "mp3":
                status = "skipped"
            else:
                data, content_type = fetch(url, referer=BOARD)
                if is_audio(data) != "mp3":
                    raise ValueError(f"Expected MP3, received {content_type}")
                temporary = target.with_suffix(".mp3.part")
                temporary.write_bytes(data)
                temporary.replace(target)
                status = "downloaded"
            entry.update(status=status, bytes=target.stat().st_size)
            stats[status] += 1
        except Exception as error:
            stats["failed"] += 1
            entry.update(status="failed", error=str(error))
            print(f"FAILED {filename}: {error}", flush=True)
        clips.append(entry)
        save()
        if index % 25 == 0 or index == len(ids):
            print(f"{index}/{len(ids)}: {stats}", flush=True)
        time.sleep(args.delay)
    return int(bool(stats["failed"]))


if __name__ == "__main__":
    raise SystemExit(main())
