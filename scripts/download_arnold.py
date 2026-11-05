#!/usr/bin/env python3
"""Download clips from a 101soundboards.com board (default: Arnold Flash Soundboard).

Standard library only. Resumable: existing valid files are skipped and the
manifest is rewritten at the end (and periodically). Clips are copyrighted
source audio; keep them for local use and do not redistribute.

Usage: python3 scripts/download_arnold.py [--board URL] [--out DIR] [--delay 1.0]
"""
import argparse
import html
import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

DEFAULT_BOARD = "https://www.101soundboards.com/boards/34017-arnold-schwarzenegger-flash-soundboard"
UA = "Mozilla/5.0 (compatible; local-asset-downloader/1.0)"
ITEM_RE = re.compile(
    r'data-sound-filename-url="([^"]+)".*?<a\s+href="([^"]+)">(.*?)</a>', re.S
)


def fetch(url, retries=4, delay=2.0, referer=None):
    headers = {"User-Agent": UA}
    if referer:
        headers["Referer"] = referer
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read(), r.headers.get("Content-Type", "")
        except urllib.error.HTTPError as e:
            if e.code in (401, 403, 404, 410):
                raise  # access restriction or missing: do not retry or bypass
            err = e
        except (urllib.error.URLError, TimeoutError) as e:
            err = e
        if attempt == retries - 1:
            raise err
        time.sleep(delay * 2 ** attempt)


def slugify(name):
    s = html.unescape(name).lower().replace("'", "").replace("\u2019", "")
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return (s[:80].strip("-")) or "clip"


def list_clips(board, delay):
    clips, seen, page = [], set(), 1
    while True:
        url = board if page == 1 else f"{board}?page={page}"
        body, _ = fetch(url)
        text = body.decode("utf-8", "replace")
        found = 0
        for src, page_url, title in ITEM_RE.findall(text):
            found += 1
            if src in seen:
                continue
            seen.add(src)
            name = html.unescape(re.sub(r"<[^>]+>", "", title)).strip()
            clips.append({"name": name, "url": src, "page_url": page_url})
        print(f"page {page}: {found} clips ({len(seen)} unique so far)", flush=True)
        if found == 0 or f"?page={page + 1}" not in text:
            break
        page += 1
        time.sleep(delay)
    return clips


def is_audio(data):
    """Check magic bytes: MP3 (ID3 / frame sync), WAV, OGG."""
    if len(data) < 1024:
        return None
    head = data[:12]
    if head.startswith(b"ID3") or (head[0] == 0xFF and head[1] & 0xE0 == 0xE0):
        return "mp3"
    if head[:4] == b"RIFF" and head[8:12] == b"WAVE":
        return "wav"
    if head[:4] == b"OggS":
        return "ogg"
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--board", default=DEFAULT_BOARD)
    ap.add_argument("--out", default=str(Path(__file__).resolve().parent.parent / "assets/audio/arnold"))
    ap.add_argument("--delay", type=float, default=1.0)
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    clips = list_clips(args.board, args.delay)
    print(f"discovered {len(clips)} clips")

    used, manifest, stats = set(), [], {"downloaded": 0, "skipped": 0, "failed": 0}
    for i, c in enumerate(clips, 1):
        base = slugify(c["name"])
        ext = Path(c["url"]).suffix or ".mp3"
        fname, n = base + ext, 2
        while fname in used:
            fname, n = f"{base}-{n}{ext}", n + 1
        used.add(fname)
        # a clip may already be sorted into primary/ or secondary/ (see sort_arnold.py)
        path = next((p for p in (out / fname, out / "primary" / fname, out / "secondary" / fname) if p.exists()), out / fname)
        fname = str(path.relative_to(out))
        entry = {"name": c["name"], "file": fname, "source_url": c["url"], "page_url": c["page_url"]}

        if path.exists() and is_audio(path.read_bytes()):
            stats["skipped"] += 1
            entry.update(status="skipped", bytes=path.stat().st_size)
        else:
            try:
                data, ctype = fetch(c["url"], referer=args.board)
                kind = is_audio(data)
                if not kind:
                    raise ValueError(f"not audio (content-type {ctype})")
                tmp = path.with_suffix(path.suffix + ".part")
                tmp.write_bytes(data)
                tmp.replace(path)
                stats["downloaded"] += 1
                entry.update(status="downloaded", bytes=len(data), format=kind)
                time.sleep(args.delay)
            except Exception as e:  # keep going; failures are listed in the manifest
                stats["failed"] += 1
                entry.update(status="failed", error=str(e))
                print(f"FAILED {c['name']}: {e}", file=sys.stderr)
        manifest.append(entry)
        if i % 25 == 0:
            print(f"{i}/{len(clips)} {stats}", flush=True)

    (out / "manifest.json").write_text(
        json.dumps({"board": args.board, "stats": stats, "clips": manifest}, indent=2, ensure_ascii=False)
    )
    print(f"discovered={len(clips)} {stats}")
    return 1 if stats["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
