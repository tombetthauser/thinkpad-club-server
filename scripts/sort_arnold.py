#!/usr/bin/env python3
"""Sort downloaded Arnold clips into primary/ and secondary/ and update manifest.json.

Primary = the most widely quoted / most commonly featured lines on classic
Arnold soundboards (Terminator franchise, Kindergarten Cop, Commando-era
one-liners). Everything else is secondary. Idempotent; safe to rerun.

Usage: python3 scripts/sort_arnold.py [--dir assets/audio/arnold]
"""
import argparse
import json
import shutil
from pathlib import Path

PRIMARY = {
    "ill-be-back",
    "im-back",
    "you-are-terminated",
    "who-is-your-daddy-and-what-does-it-do",
    "put-that-cookie-down-now",
    "stop-whining",
    "talk-to-the-hand",
    "im-a-cop-you-idiot",
    "my-mission-is-to-protect-you",
    "im-a-cybernetic-organism",
    "judgment-day-is-inevitable",
    "no-problemo",
    "your-clothes-give-them-to-me-now",
    "sarah-connor",
    "who-is-john-connor",
    "cyberdyne-systems-model-101",
    "see-its-my-body-youve-got-there-and-i-want-it-back",
    "this-is-your-new-class-mascot",
    "there-is-no-bathroom",
    "who-told-you-can-eat-my-cookies",
    "im-detective-john-kimble",
    "your-choirboys-better-be-quiet-boy",
    "you-think-you-know-bad-your-choirboy-compared-to-me-im-quiet-boy",
    "ive-got-news-for-you-you-are-mine-now-you-belong-to-me",
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=str(Path(__file__).resolve().parent.parent / "assets/audio/arnold"))
    d = Path(ap.parse_args().dir)
    mf = d / "manifest.json"
    data = json.loads(mf.read_text())

    stems = {Path(c["file"]).stem for c in data["clips"]}
    missing = PRIMARY - stems
    if missing:
        print("WARNING: primary names not in manifest:", sorted(missing))

    counts = {"primary": 0, "secondary": 0}
    for c in data["clips"]:
        name = Path(c["file"]).name
        tier = "primary" if Path(name).stem in PRIMARY else "secondary"
        dest = d / tier / name
        dest.parent.mkdir(exist_ok=True)
        for src in (d / name, d / "primary" / name, d / "secondary" / name):
            if src.exists() and src != dest:
                shutil.move(str(src), str(dest))
        c["file"], c["tier"] = f"{tier}/{name}", tier
        counts[tier] += 1

    mf.write_text(json.dumps(data, indent=2, ensure_ascii=False))
    print(counts)


if __name__ == "__main__":
    main()
