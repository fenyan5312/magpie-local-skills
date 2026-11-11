#!/usr/bin/env python3
"""Print checkpoint deltas for both learners from a progress JSON file."""

import json
import sys
from pathlib import Path


def summarize(path):
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    learners = data.get("learners", {})
    if len(learners) != 2:
        raise ValueError("progress JSON must contain exactly two learners")
    for name, row in learners.items():
        planned = row.get("planned_minutes", 0)
        actual = row.get("actual_minutes", 0)
        planned_tasks = row.get("planned_tasks", 0)
        completed_tasks = row.get("completed_tasks", 0)
        rate = "%.1f%%" % (actual * 100.0 / planned) if planned else "N/A"
        task_rate = (
            "%.1f%%" % (completed_tasks * 100.0 / planned_tasks)
            if planned_tasks
            else "N/A"
        )
        print(
            "%s: minutes=%s/%s (%s), tasks=%s/%s (%s), backlog=%s"
            % (
                name,
                actual,
                planned,
                rate,
                completed_tasks,
                planned_tasks,
                task_rate,
                len(row.get("backlog_tasks", [])),
            )
        )


def main():
    if len(sys.argv) != 2:
        print("Usage: summarize_progress.py <progress.json>")
        return 2
    try:
        summarize(sys.argv[1])
    except Exception as exc:
        print("INVALID: %s" % exc)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
