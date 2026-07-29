"""
Source shape: the multi-sheet BOOKING / COURSE-INTAKE spreadsheet.

WHAT THIS SHAPE LOOKS LIKE
-------------------------
The business's real operating system: one workbook, one sheet per class level,
kept as a running log for years. Inside a sheet:

    STARTS Tuesday 4th March, 6pm 'The Dalmatians'      <- a course header row
    Name        Email       Phone     Puppy   Breed     <- a column-label row
    Jo Bloggs   jo@x.co.nz  021...    Teddy   Yorkie    <- enrolments
    Ana Smith   ana@y.com   027...    Bella   Poodle
    STARTS Thursday 12th June, 10am 'The Beagles'       <- next intake
    ...

and a separate Waitlist sheet using ALL-CAPS category headers instead.

THE TWO THINGS THAT MAKE IT HARD
--------------------------------
1. **Every sheet has a different column order, and one of them changed order
   mid-sheet** — a trainer inserted Puppy Name / Breed / VAXX columns around
   row 142 and kept typing. So no cell is read by position (column A, the
   person's name, is the single exception). See lib/classify.py.

2. **Course boundaries are rows, not columns.** A row belongs to whichever
   header row it sits under. Rows above the first header belong to nothing and
   are skipped; a note sentence that merely mentions a weekday must not be
   mistaken for a header, so a header also has to carry a time AND a month AND
   start with the weekday.

WHAT IT EMITS
-------------
Two fragments from one file, because the class sheets and the waitlist sheet
are different kinds of evidence with different reliability:

    "<label>"           deduped people + their class history + the courses
    "<label>_waitlist"  people who only ever enquired

Deduplication inside this source is by email, then phone, then (only when
there is neither) name — the same person appears in twenty intakes over five
years and must come out as one person with twenty enrolments.
"""

from __future__ import annotations

import re
from pathlib import Path

from lib import parsing
from lib.plan_schema import empty_course_ref, empty_fragment, empty_person_fragment

from ._workbook import read as read_workbook

SHAPE = "booking_spreadsheet"


def vocabulary(path: Path, options: dict) -> dict:
    """
    Contributed to later sources: the breeds and suburbs THIS client actually
    uses. A contacts file cannot tell a breed from a note until it has seen
    the client's own breed column.
    """
    data = read_workbook(path, options)
    breeds = [e["breed"] for e in data["enrolments"] if e.get("breed")]
    suburbs = set()
    for c in data["clients"]:
        for part in (c.get("address") or "").split(","):
            v = parsing.norm_name(part)
            if v and 1 <= len(v.split()) <= 3 and not re.search(r"\d", v):
                suburbs.add(v)
    return {"breeds": breeds, "suburbs": suburbs}


def extract(path: Path, options: dict, ctx) -> list[dict]:
    """Return [classes fragment, waitlist fragment]."""
    label = options.get("label") or "spreadsheet"
    waitlist_label = options.get("waitlistLabel") or "waitlist"
    data = read_workbook(path, options)

    frag = empty_fragment(label)
    # This source deduplicates its own rows (by email, then phone, then name)
    # before emitting them, so the engine must take each record as a distinct
    # person rather than re-matching them against each other by name.
    frag["selfDeduped"] = True
    # Helpers are marked in prose in the notes column ("B:Volunteer", "F:INTERN").
    frag["scanNotesForRoles"] = True
    frag["courses"] = [
        {"externalId": c["id"], "level": c["sheet"], "nickname": c["nickname"],
         "day": c["day"], "date": c["date"], "time": c["time"],
         "location": c["location"], "headerRaw": c["headerRaw"]}
        for c in data["courses"]
    ]
    frag["needsReview"] = [
        {"kind": "Spreadsheet row could not be read", "who": "",
         "detail": f"{n['sheet']} row {n['row']} — {n['reason']}: {n['raw']}"}
        for n in data["needsReview"]
    ]

    enrol_by_row = {e["sourceCode"]: e for e in data["enrolments"]}

    for cl in data["clients"]:
        p = empty_person_fragment(label)
        name = parsing.clean(cl.get("name"))
        p["name"] = name
        p["email"] = parsing.norm_email(cl.get("email"))
        p["phone"] = parsing.clean(cl.get("phone"))
        p["address"] = parsing.clean(cl.get("address"))
        p["sourceKey"] = f"client::{name}::{','.join(cl.get('sourceRows') or [])}"
        if cl.get("notes"):
            p["notes"].append(cl["notes"])
        if cl.get("multipleNamesOnKey"):
            p["flags"].append("spreadsheet row held more than one name")
            p["review"].append({
                "kind": "More than one name on the row", "who": name,
                "detail": "The spreadsheet cell held several names — "
                          "check who this is."})
        if parsing.looks_like_junk_person(name):
            p["flags"].append("name may not be a person's name")
            p["review"].append({
                "kind": "Odd client name", "who": name,
                "detail": f"'{name}' does not look like a person's name — check "
                          f"the spreadsheet rows "
                          f"{', '.join(cl.get('sourceRows') or [])}."})
        if name and len(name.split()) == 1:
            p["flags"].append("only a first name in the spreadsheet")

        # One pass over the rows this person appeared on: each row carries a
        # dog + breed + age AND a class enrolment.
        for row in cl.get("sourceRows") or []:
            en = enrol_by_row.get(row)
            if not en:
                continue
            age = parsing.clean(en.get("age"))
            p["dogs"].append({
                "name": en.get("dog") or "", "breed": parsing.clean(en.get("breed")),
                "note": f"Age at booking: {age}" if age else "",
                "deceased": False, "deceasedAt": None,
                "judge": True, "where": f"spreadsheet row {row}",
            })
            ref = empty_course_ref()
            ref.update({"externalId": en["courseId"], "dog": en.get("dog") or "",
                        "judgeDog": True, "sourceRow": row,
                        "where": f"spreadsheet row {row}"})
            p["courseRefs"].append(ref)

        # Dogs recorded against the person but not against any enrolment row.
        for d in cl.get("dogs") or []:
            p["dogs"].append({
                "name": d, "breed": "", "note": "", "deceased": False,
                "deceasedAt": None, "judge": True,
                "where": "the spreadsheet client row", "requireName": True,
            })

        # Defensive: a class id with no surviving enrolment row.
        for cid in cl.get("courseIds") or []:
            ref = empty_course_ref()
            ref.update({"externalId": cid})
            p["courseRefs"].append(ref)

        frag["people"].append(p)

    # ---- waitlist ---------------------------------------------------------
    wl = empty_fragment(waitlist_label)
    # The waitlist is another sheet of the SAME document, kept by the same
    # person. Matching one of its leads to a client by name is the expected
    # outcome, not a cross-file coincidence worth a review line.
    wl["announceNameMatch"] = False
    for w in data["waitlist"]:
        p = empty_person_fragment(waitlist_label)
        name = parsing.clean(w.get("name"))
        p["name"] = name
        p["email"] = parsing.norm_email(w.get("email"))
        p["phone"] = parsing.clean(w.get("phone"))
        p["address"] = parsing.clean(w.get("address"))
        p["sourceKey"] = f"waitlist::{name}::{w.get('sourceRow')}"
        p["waitlist"].append({
            "category": w.get("category"),
            "sourceRow": w.get("sourceRow"),
            "breedAge": w.get("breedAge"),
            "dogRaw": w.get("dog"),
            "notes": w.get("notes"),
        })
        wl["people"].append(p)

    return [frag, wl]
