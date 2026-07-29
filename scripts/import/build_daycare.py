#!/usr/bin/env python3
"""
Build a client's DAYCARE plan — the day-parts and bookings `plan.json` cannot carry.

    python3 scripts/import/build_daycare.py clients/dukes.json \
            --plan /tmp/dukes_plan.json -o /tmp/dukes_daycare.json

WHY THIS IS A SECOND PLAN AND NOT PART OF THE FIRST
---------------------------------------------------
`plan.json` describes PEOPLE — who they are, their dogs, and the classes and
consults they have bought. Its two class-shaped concepts are a course (a cohort
with a fixed number of weekly sessions) and a 1:1 consult. A daycare booking is
neither: nobody enrols in a cohort, there is no session count, and the same dog
comes every Tuesday indefinitely.

PupManager does model this — a Package with `isPuppySchool` (which in this
codebase means daycare), day-parts as `PackageSessionSlot`, and each booking as
a drop-in `ClassEnrollment` against one session. But none of that is expressible
in the canonical plan, and widening the plan schema would change the load half
for every client to serve one. So the daycare side gets its own small plan and
its own loader, layered AFTER the main import and matching into the people it
created. The two meet the same way everything else here does: at a JSON file.

WHAT IT DECIDES, AND WHY
------------------------
**A slot is keyed on (weekday, START time) — not on the end time.** The week
board buckets a day's cells by start time alone, so two day-parts that begin at
the same minute occupy the same cell and the second silently hides the first.
Dukes' full day (7:00am–6:00pm) and its occasional half day (7:00am–12:00pm)
start together, so they are ONE slot and the half day is recorded on the
booking. The alternative — moving the half day to an invented start time so the
board could separate them — would be making data up to suit a grid.

**Capacity and price are left null.** The reports show neither. A daycare
without a capacity looks unlimited, which is wrong but honest; a daycare with a
capacity somebody guessed is wrong and convincing.

**An absence is a booking.** A row whose slot reads "NOT HERE - add reason" is
a dog that was booked and did not come, so it becomes an enrolment plus an
ABSENT attendance mark, not a missing row.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from lib import parsing                                  # noqa: E402
from lib.config import ClientConfig                      # noqa: E402
from sources.doggie_dashboard_reports import parse_appointments   # noqa: E402

# "Tuesday July 21 7:00am"
_WHEN = re.compile(
    r"^(?P<weekday>\w+)\s+(?P<month>\w+)\s+(?P<day>\d{1,2})\s+"
    r"(?P<hour>\d{1,2}):(?P<minute>\d{2})(?P<meridiem>am|pm)$", re.I)
_MONTHS = {m: i for i, m in enumerate(
    ("january", "february", "march", "april", "may", "june", "july",
     "august", "september", "october", "november", "december"), start=1)}
# Prisma's PackageSessionSlot.day: 0 = Sunday … 6 = Saturday.
_DOW = {"sunday": 0, "monday": 1, "tuesday": 2, "wednesday": 3,
        "thursday": 4, "friday": 5, "saturday": 6}

# A slot value that describes the BOOKING rather than the group the dog is in.
_ABSENT = "not here - add reason"
_EXTRA = "extra - not their regular day"
_NON_GROUP = {_ABSENT, _EXTRA}


def _parse_when(raw: str, default_year: int) -> tuple[str, str] | None:
    """"Tuesday July 21 7:00am" -> ("2026-07-21", "07:00"), or None."""
    m = _WHEN.match(parsing.clean(raw))
    if not m:
        return None
    month = _MONTHS.get(m.group("month").lower())
    if not month:
        return None
    hour = int(m.group("hour")) % 12
    if m.group("meridiem").lower() == "pm":
        hour += 12
    return (f"{default_year}-{month:02d}-{int(m.group('day')):02d}",
            f"{hour:02d}:{m.group('minute')}")


def build(cfg: ClientConfig, plan: dict, package_name: str,
          default_year: int, default_label: str = "Daycare day") -> dict:
    # ---- who is who ------------------------------------------------------
    # The appointment reports know an owner by name only. The main plan knows
    # the same people by name AND by the email the loader keyed their account
    # on, so the join runs through the plan rather than guessing.
    email_by_name: dict[str, str] = {}
    dogs_by_name: dict[str, list[str]] = {}
    for person in plan.get("people") or []:
        key = parsing.norm_name(person.get("fullName") or "")
        if key and key not in email_by_name:
            email_by_name[key] = person.get("email") or ""
            dogs_by_name[key] = [d.get("name") or "" for d in person.get("dogs") or []]

    # ---- read every outlook the config lists ------------------------------
    rows: list[dict] = []
    windows: list[str] = []
    for f in cfg.files:
        if (f.options or {}).get("report") != "appointments":
            continue
        window = (f.options or {}).get("window", f.name)
        windows.append(window)
        for a in parse_appointments(f.path):
            a["window"] = window
            rows.append(a)

    needs_review: list[dict] = []
    bookings: list[dict] = []
    # (weekday, startTime) -> the end times seen, so the slot can take the
    # commonest one rather than whichever row happened to be read first.
    ends: dict[tuple[int, str], Counter] = defaultdict(Counter)
    labels: dict[tuple[int, str], Counter] = defaultdict(Counter)
    dates: dict[tuple[int, str], set[str]] = defaultdict(set)

    for a in rows:
        start = _parse_when(a["start"], default_year)
        end = _parse_when(a["end"], default_year)
        if not start:
            needs_review.append({
                "kind": "Appointment with no readable time",
                "who": a.get("owner", ""),
                "detail": (f"{a.get('pet') or 'A dog'} for {a.get('owner') or 'an owner'} "
                           f"has times the report did not print "
                           f"({a.get('start') or 'blank'}). Not imported as a "
                           f"booking — check the {a['window']} outlook."),
            })
            continue
        iso_date, start_time = start
        weekday = _DOW.get((a.get("weekday") or "").lower())
        if weekday is None:
            weekday = date.fromisoformat(iso_date).isoweekday() % 7
        key = (weekday, start_time)
        if end:
            ends[key][end[1]] += 1
        dates[key].add(iso_date)

        slot_raw = (a.get("slot") or "").strip()
        slot_key = slot_raw.lower()
        absent = slot_key == _ABSENT
        if slot_key and slot_key not in _NON_GROUP:
            labels[key][slot_raw] += 1

        owner_key = parsing.norm_name(a.get("owner") or "")
        email = email_by_name.get(owner_key, "")
        if not email:
            needs_review.append({
                "kind": "Appointment for an owner who is not in the owner file",
                "who": a.get("owner", ""),
                "detail": (f"The {a['window']} outlook books {a.get('pet') or 'a dog'} "
                           f"for {a.get('owner') or 'an unnamed owner'}, who has no "
                           f"row in the owner export. The booking was not imported."),
            })
            continue

        bookings.append({
            "date": iso_date,
            "slotKey": f"{weekday}-{start_time}",
            "ownerEmail": email,
            "owner": a.get("owner", ""),
            "dog": a.get("pet", ""),
            "group": slot_raw if slot_key not in _NON_GROUP else "",
            "bookingType": a.get("type", ""),
            "attended": not absent,
            "extraDay": slot_key == _EXTRA,
            "endTime": end[1] if end else "",
            "window": a["window"],
        })

    # ---- the day-parts ----------------------------------------------------
    slots = []
    for (weekday, start_time), seen_dates in sorted(dates.items()):
        end_time = ends[(weekday, start_time)].most_common(1)
        label = labels[(weekday, start_time)]
        # The slot's name comes from the groups seen in it, but ONLY when there
        # is one. Dukes runs Little Dogs and Big Dogs side by side all day, so
        # taking the commonest would label Tuesday "Little Dogs" and Wednesday
        # "Big Dogs" — a real-looking distinction that does not exist. Several
        # groups at one time means the slot is the DAY-PART, and which group a
        # dog is in stays on the booking where it belongs.
        if len(label) == 1:
            name = label.most_common(1)[0][0]
        elif label:
            name = default_label
        else:
            name = f"{start_time} session"
        slots.append({
            "key": f"{weekday}-{start_time}",
            "day": weekday,
            "startTime": start_time,
            "endTime": end_time[0][0] if end_time else "",
            "label": name,
            "groups": [g for g, _ in label.most_common()],
            "dates": sorted(seen_dates),
            "capacity": None,
            "priceCents": None,
        })

    # A slot whose end time was ambiguous is worth a look — it decides how long
    # every session generated from it runs for.
    for slot in slots:
        counts = ends[(slot["day"], slot["startTime"])]
        if len(counts) > 1:
            spread = ", ".join(f"{t} ×{n}" for t, n in counts.most_common())
            needs_review.append({
                "kind": "Day-part with more than one end time",
                "who": slot["label"],
                "detail": (f"Bookings starting at {slot['startTime']} end at "
                           f"{spread}. The day-part was created ending "
                           f"{slot['endTime']} (the commonest), and each booking "
                           f"keeps its own type. The week board groups a day's "
                           f"cells by start time, so two day-parts starting at "
                           f"the same minute cannot be shown apart."),
            })

    sessions = [
        {"slotKey": slot["key"], "date": d, "startTime": slot["startTime"],
         "endTime": slot["endTime"], "title": package_name}
        for slot in slots for d in slot["dates"]
    ]

    return {
        "meta": {
            "generatedBy": "build_daycare.py",
            "client": cfg.name,
            "slug": cfg.slug,
            "windows": windows,
            "counts": {
                "slots": len(slots),
                "sessions": len(sessions),
                "bookings": len(bookings),
                "absences": sum(1 for b in bookings if not b["attended"]),
                "appointmentsRead": len(rows),
                "needsReview": len(needs_review),
            },
        },
        "package": {
            "name": package_name,
            # Left null on purpose: the reports state neither, and a guessed
            # capacity is a number somebody will later rely on.
            "capacity": None,
            "priceCents": None,
        },
        "slots": slots,
        "sessions": sessions,
        "bookings": bookings,
        "needsReview": needs_review,
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        description="Build the daycare plan (day-parts + bookings) for a client.")
    ap.add_argument("config", help="path to the client config JSON")
    ap.add_argument("--plan", required=True,
                    help="the plan.json built by build_plan.py — supplies the "
                         "email each owner's account was keyed on")
    ap.add_argument("-o", "--out", default=None)
    ap.add_argument("--name", default=None,
                    help="the daycare offering's name (default: '<client> Daycare')")
    ap.add_argument("--year", type=int, default=None,
                    help="the year the outlooks cover (default: this year)")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args(argv)

    cfg_path = Path(args.config).expanduser()
    if not cfg_path.exists():
        print(f"no such config: {cfg_path}", file=sys.stderr)
        return 1
    cfg = ClientConfig.load(cfg_path)

    plan_path = Path(args.plan).expanduser()
    if not plan_path.exists():
        print(f"no such plan: {plan_path}", file=sys.stderr)
        return 1
    plan = json.loads(plan_path.read_text(encoding="utf-8"))

    name = args.name or f"{cfg.name} Daycare"
    year = args.year or date.today().year
    out = build(cfg, plan, name, year)

    target = Path(args.out) if args.out else cfg_path.with_name(f"{cfg.slug}_daycare.json")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")

    if not args.quiet:
        print(f"wrote {target}\n")
        for k, v in out["meta"]["counts"].items():
            print(f"  {k:20} {v}")
        print("\n  day-parts:")
        for s in out["slots"]:
            print(f"    day {s['day']}  {s['startTime']}–{s['endTime'] or '?':5}  "
                  f"{s['label']:<14} {len(s['dates'])} date(s)")
        if out["needsReview"]:
            print()
            for r in out["needsReview"]:
                print(f"  ! {r['kind']}: {r['who']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
