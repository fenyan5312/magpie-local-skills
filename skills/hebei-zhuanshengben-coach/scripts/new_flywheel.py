#!/usr/bin/env python3
"""Create today's flywheel Markdown from the maintained asset template."""

import argparse
import datetime as dt
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", default=dt.date.today().isoformat())
    parser.add_argument("--root", required=True)
    parser.add_argument("--template", required=True)
    args = parser.parse_args()

    root = Path(args.root)
    template = Path(args.template)
    target = root / "飞轮" / ("%s.md" % args.date)
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        print("EXISTS: %s" % target)
        return 0
    target.write_text(
        template.read_text(encoding="utf-8").replace("YYYY-MM-DD", args.date),
        encoding="utf-8",
    )
    print("CREATED: %s" % target)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
