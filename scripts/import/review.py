#!/usr/bin/env python3
"""
Turn a plan into things a human can review.

    python3 scripts/import/review.py <plan.json> <output-dir>

Writes into the output directory:

    review.xlsx      one tab per kind of decision (archival copy)
    review.html      the same workbook as ONE self-contained offline page,
                     because there is no spreadsheet app on this machine and
                     the data must not go near a hosted viewer
    csv/01..08       the machine-readable hand-off, including
                     01_people_and_dogs.csv shaped for the destination app's
                     own bulk-import wizard

It re-validates the plan first and refuses to render an invalid one. Rendering
a broken plan produces a review that looks authoritative and is not, which is
worse than no review at all.

NO DATABASE. NO NETWORK. This is still the extract half.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from lib import html_view, plan_schema, render   # noqa: E402


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        description="Render a plan as a workbook, an HTML page and CSVs.")
    ap.add_argument("plan", help="path to plan.json")
    ap.add_argument("out", help="output directory")
    ap.add_argument("--force", action="store_true",
                    help="render even if the plan fails validation")
    args = ap.parse_args(argv)

    plan_path = Path(args.plan).expanduser()
    if not plan_path.exists():
        print(f"no such plan: {plan_path}", file=sys.stderr)
        return 1
    plan = json.loads(plan_path.read_text(encoding="utf-8"))

    problems = [p for p in plan_schema.validate(plan) if p.level == "error"]
    if problems and not args.force:
        for p in problems[:20]:
            print(f"  {p}", file=sys.stderr)
        print(f"\n{len(problems)} validation error(s). Fix the plan, or pass "
              f"--force to render it anyway.", file=sys.stderr)
        return 2

    out = Path(args.out).expanduser()
    out.mkdir(parents=True, exist_ok=True)

    client = plan.get("meta", {}).get("clientName") or plan.get("meta", {}).get(
        "client") or plan_path.stem
    xlsx = out / "review.xlsx"
    render.workbook(plan).save(xlsx)
    html_view.render(xlsx, out / "review.html", title=f"{client} — import review")

    csv_dir = out / "csv"
    written = render.csvs(plan, csv_dir)

    summary = plan_schema.summarise(plan)
    print(f"{client}\n")
    print(f"  {xlsx}")
    print(f"  {out / 'review.html'}")
    for name, n in written:
        print(f"  {csv_dir / name}   {n:>5} rows")
    print()
    width = max(len(k) for k in summary)
    for k, v in summary.items():
        print(f"  {k:<{width}}  {v}")
    deceased = sum(1 for p in plan["people"] for d in p.get("dogs") or []
                   if d.get("deceasedAt"))
    print(f"\n  {summary['placeholderEmails']} people deliberately have no real "
          f"email — they must never merge with anyone")
    print(f"  {deceased} deceased dog(s) — the bulk-import wizard cannot carry "
          f"that; the load script sets it")
    if problems:
        print(f"\n  rendered with --force despite {len(problems)} error(s)",
              file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
