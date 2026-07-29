"""
Turn import_plan.json into spreadsheets.

The headline output is `01_people_and_dogs.csv`, written so PupManager's own
bulk-import wizard (/clients/import) auto-maps every column with no manual
mapping: the headers are the exact labels in src/lib/client-fields.ts, and the
five custom-field columns match the labels created by ensure-fields.ts.

Header gotcha worth knowing: the wizard's auto-mapper sends ANY header
containing "note"/"notes"/"comment" to the DOG's notes field. The person-level
free text is therefore exported as "Background" so it lands on the owner.

The remaining CSVs carry what the wizard structurally cannot import (it only
creates User + ClientProfile + Dog + CustomField + CustomFieldValue): courses,
enrolments, 1:1 consults and subscribers. Those go through the import script.

Usage:
    python3 scripts/prime/export-csv.py <import_plan.json> <output-dir>
"""

import csv
import json
import sys
from pathlib import Path

# Exact labels from src/lib/client-fields.ts, so guessBuiltin() matches them.
PEOPLE_HEADERS = [
    "Client name", "Email", "Phone", "Address",
    "Dog's name", "Breed",
    # Custom fields — labels must match those created by ensure-fields.ts.
    "Volunteer", "Professional", "Previous trainer", "Business", "Credit",
    # NOT "Notes": that would auto-map to the dog. See module docstring.
    "Background",
]


def full_address(p: dict) -> str:
    parts = [p.get("address") or "", p.get("city") or "", p.get("postcode") or ""]
    return ", ".join(x.strip() for x in parts if x and x.strip())


def people_rows(plan: dict):
    """One row per person × dog. A person with no dog still gets a row."""
    for p in plan["people"]:
        cf = p.get("customFields") or {}
        # A placeholder email is invented, not evidence — leave it blank so the
        # wizard mints its own non-merging placeholder instead of importing a
        # fake address as if it were real.
        email = "" if p.get("emailIsPlaceholder") else (p.get("email") or "")

        base = {
            "Client name": p.get("fullName") or " ".join(
                x for x in [p.get("firstName"), p.get("lastName")] if x
            ).strip(),
            "Email": email,
            "Phone": p.get("phone") or "",
            "Address": full_address(p),
            "Volunteer": cf.get("Volunteer", ""),
            "Professional": cf.get("Professional", ""),
            "Previous trainer": cf.get("Previous trainer", ""),
            "Business": cf.get("Business", "") or p.get("company") or "",
            "Credit": cf.get("Credit", ""),
            "Background": p.get("notes") or "",
        }

        dogs = p.get("dogs") or []
        if not dogs:
            yield {**base, "Dog's name": "", "Breed": ""}
            continue

        for i, dog in enumerate(dogs):
            row = {**base, "Dog's name": dog.get("name") or "", "Breed": dog.get("breed") or ""}
            if i:
                # Same person, extra dog: the wizard merges on email. Repeating
                # the owner columns is harmless, but blanking the one-per-person
                # text fields avoids writing them twice.
                row["Background"] = ""
                row["Credit"] = ""
            yield row


def write_csv(path: Path, headers: list[str], rows: list[dict]) -> None:
    with path.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=headers, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    print(f"  {path.name:<34} {len(rows):>5} rows")


def main(plan_path: Path, out_dir: Path) -> None:
    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    out_dir.mkdir(parents=True, exist_ok=True)
    print(f"Writing to {out_dir}\n")

    rows = list(people_rows(plan))
    write_csv(out_dir / "01_people_and_dogs.csv", PEOPLE_HEADERS, rows)

    write_csv(
        out_dir / "02_courses.csv",
        ["id", "origin", "level", "name", "nickname", "date", "month", "year",
         "time", "location", "priorProvider", "enrolmentCount"],
        plan["courses"],
    )

    enrolments = [
        {
            "person": p.get("fullName"),
            "email": "" if p.get("emailIsPlaceholder") else p.get("email"),
            "courseId": e.get("courseId"),
            "course": e.get("courseName"),
            "level": e.get("level"),
            "courseOrigin": e.get("courseOrigin"),
            "dog": e.get("dog"),
            "priorProvider": e.get("priorProvider"),
            "sources": ", ".join(e.get("sources") or []),
        }
        for p in plan["people"] for e in (p.get("enrolments") or [])
    ]
    write_csv(
        out_dir / "03_enrolments.csv",
        ["person", "email", "courseId", "course", "level", "courseOrigin",
         "dog", "priorProvider", "sources"],
        enrolments,
    )

    consults = [
        {
            "person": p.get("fullName"),
            "email": "" if p.get("emailIsPlaceholder") else p.get("email"),
            **({"detail": c} if isinstance(c, str) else c),
        }
        for p in plan["people"] for c in (p.get("oneToOneConsults") or [])
    ]
    consult_headers = ["person", "email"] + sorted(
        {k for c in consults for k in c if k not in ("person", "email")}
    )
    write_csv(out_dir / "04_one_to_one_consults.csv", consult_headers, consults)

    write_csv(
        out_dir / "05_subscribers.csv",
        ["email", "name", "linkedBy", "acceptsMarketing", "createdOn"],
        plan["subscribers"],
    )
    write_csv(out_dir / "06_needs_review.csv", ["kind", "who", "detail"], plan["needsReview"])
    write_csv(
        out_dir / "07_field_overrides.csv",
        ["person", "field", "kept", "keptFrom", "discarded", "discardedFrom"],
        plan["fieldOverrides"],
    )
    write_csv(
        out_dir / "08_junk_dog_names.csv",
        ["person", "where", "value", "reason"],
        plan["junkDogNameOverrides"],
    )

    people = plan["people"]
    dogs = sum(len(p.get("dogs") or []) for p in people)
    deceased = sum(1 for p in people for d in (p.get("dogs") or []) if d.get("deceasedAt"))
    blank_email = sum(1 for p in people if p.get("emailIsPlaceholder"))
    print(
        f"\n{len(people)} people · {dogs} dogs · {len(rows)} rows in the people CSV"
        f"\n{blank_email} rows deliberately have a blank email (they must never merge)"
        f"\n{deceased} deceased dog(s) — the wizard cannot carry that; the import script sets it"
    )


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(Path(sys.argv[1]), Path(sys.argv[2]))
