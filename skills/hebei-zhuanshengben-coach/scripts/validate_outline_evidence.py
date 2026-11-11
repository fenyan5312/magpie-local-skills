#!/usr/bin/env python3
"""Validate one official outline evidence record before plan generation."""

import json
import sys
from datetime import datetime
from pathlib import Path


ALLOWED_STATUS = {"confirmed", "fallback_confirmed", "unavailable"}
OFFICIAL_HOST_MARKERS = ("hebeea.edu.cn",)


def is_official_url(url):
    if not isinstance(url, str) or not url.startswith(("http://", "https://")):
        return False
    return any(marker in url for marker in OFFICIAL_HOST_MARKERS)


def validate(path):
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    required = {"subject", "year", "fallback_used", "checked_at", "status", "notes"}
    missing = sorted(required - set(data))
    if missing:
        raise ValueError("missing fields: " + ", ".join(missing))
    if data["year"] not in (2026, 2027):
        raise ValueError("year must be 2026 or 2027")
    if data["status"] not in ALLOWED_STATUS:
        raise ValueError("status must be confirmed, fallback_confirmed, or unavailable")
    datetime.strptime(data["checked_at"], "%Y-%m-%dT%H:%M:%S+08:00")
    if data["status"] != "unavailable":
        for key in ("official_page", "official_attachment"):
            if not is_official_url(data.get(key, "")):
                raise ValueError("%s must be an official hebeea.edu.cn URL" % key)
    if data["year"] == 2027 and data["status"] == "fallback_confirmed":
        raise ValueError("2027 cannot be marked as fallback")
    return data


def main():
    if len(sys.argv) != 2:
        print("Usage: validate_outline_evidence.py <evidence.json>")
        return 2
    try:
        data = validate(sys.argv[1])
    except Exception as exc:
        print("INVALID: %s" % exc)
        return 1
    print("VALID: %s %s (%s)" % (data["subject"], data["year"], data["status"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
