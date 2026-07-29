#!/usr/bin/env python3
"""
Build a client's import plan from their raw files.

    python3 scripts/import/build_plan.py clients/journey.json [-o plan.json]

WHAT IT DOES
------------
Reads every file the client config lists, merges them into one canonical plan
(see lib/plan_schema.py), validates it, and writes plan.json.

WHAT IT DOES NOT DO
-------------------
Touch a database. Reach the network. Import anything. This is the EXTRACT half
of an onboarding: its whole job is to produce something a human can review
before anything becomes irreversible. `review.py` turns the plan into the
spreadsheets and the HTML page that review actually happens in.

DETERMINISM
-----------
Running it twice on the same inputs produces a byte-identical plan.json.
Placeholder email addresses are hashes of stable seeds, person ids are
allocated in file order, and nothing iterates a set. That is what makes
`diff` between two runs a meaningful signal rather than noise — which is how
you tell "my config change did what I meant" from "my config change did
something else as well".

EXIT CODES
----------
    0  plan written, no errors (warnings are printed but do not fail)
    1  a config or input problem — nothing was written
    2  the plan was written but failed validation; do not import it
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import sources                                    # noqa: E402
from lib import merge, plan_schema                # noqa: E402
from lib.config import ClientConfig               # noqa: E402


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        description="Build an import plan from a client's raw files.")
    ap.add_argument("config", help="path to the client config JSON")
    ap.add_argument("-o", "--out", default=None,
                    help="where to write plan.json "
                         "(default: alongside the config, <slug>_plan.json)")
    ap.add_argument("--check-only", action="store_true",
                    help="describe the inputs and exit without reading them")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args(argv)

    cfg_path = Path(args.config).expanduser()
    if not cfg_path.exists():
        print(f"no such config: {cfg_path}", file=sys.stderr)
        return 1
    cfg = ClientConfig.load(cfg_path)

    if not args.quiet:
        print(cfg.describe())
        print()
    if args.check_only:
        return 0 if all(f.path.exists() for f in cfg.files) else 1

    plan = merge.build(cfg, sources)

    out = Path(args.out) if args.out else cfg_path.with_name(f"{cfg.slug}_plan.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(plan, indent=2, ensure_ascii=False),
                   encoding="utf-8")

    problems = plan_schema.validate(plan)
    errors = [p for p in problems if p.level == "error"]
    warnings = [p for p in problems if p.level == "warning"]

    if not args.quiet:
        summary = plan_schema.summarise(plan)
        print(f"wrote {out}\n")
        width = max(len(k) for k in summary)
        for k, v in summary.items():
            print(f"  {k:<{width}}  {v}")
        print()
        for k, v in sorted(plan["meta"]["counts"].items()):
            print(f"  {k:38} {v}")
        print()

    for p in warnings[:20]:
        print(f"  {p}", file=sys.stderr)
    if len(warnings) > 20:
        print(f"  ...and {len(warnings) - 20} more warnings", file=sys.stderr)
    for p in errors:
        print(f"  {p}", file=sys.stderr)

    if errors:
        print(f"\n{len(errors)} validation error(s) — do NOT import this plan.",
              file=sys.stderr)
        return 2
    if not args.quiet:
        print(f"plan is valid ({len(warnings)} warning(s)).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
