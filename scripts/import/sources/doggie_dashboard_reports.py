"""
Source shape: DoggieDashboard's printed REPORTS (PDF).

WHAT THIS SHAPE LOOKS LIKE
--------------------------
DoggieDashboard exports one CSV — the owner file — and it is thin. Everything
a daycare actually runs on lives in reports you print, not in the export:

    Active Pets Information Report      breed, sex, colour, birthday,
                                        vaccination expiry dates, special notes
    Active Owners Information Report    address, both phones, emergency
                                        contact, FAMILY VET CLINIC
    Weekly Outlook                      appointments: pet, owner, times,
                                        slot, booking type

So the PDFs are not a nice-to-have second opinion here. They carry the only
copy of a dog's vaccination status, and a dog with a lapsed vaccination is a
dog the daycare cannot legally take. `report` in the file's options says which
of the three is being read.

WHY IT IS ITS OWN SHAPE
-----------------------
1. **It is the authority on dogs.** The CSV has one `Pets` column holding
   every dog a household has ever had, run together — `Bubble Pipi`. The pets
   report has one record per dog, each with its own breed and birthday. That
   is what turns a guess about where a name ends into a fact, and it is why
   `pet_index()` below is imported by the CSV module rather than the two
   modules each guessing separately.

2. **"Active" is load-bearing.** These reports list ACTIVE records only. A dog
   in the CSV but not in the pets report is not an error — it is a dog that has
   left, and saying so is more useful than dropping it or importing it as
   current.

3. **Appointments are not enrolments.** A daycare day is neither a class nor a
   1:1 consult, which are the two things the plan can express. Rather than
   force 273 transient bookings into a shape that would misrepresent them,
   this module reads them for what they durably say about a client — which
   days they come, which group their dog is in, how they pay — and records
   that. The appointments themselves are summarised for review, not imported.
   See `README-extract.md`; this is the one thing about a daycare the plan
   has no room for.

WHAT IT DOES NOT DO
-------------------
Merge. Like every source module it states one file's opinion and lets
`lib/merge.py` reconcile it. The pets report knows owners by NAME only — it
carries no email — so its people match by name into whoever the CSV already
created.
"""

from __future__ import annotations

import re
from collections import defaultdict
from pathlib import Path

from lib import parsing
from lib.plan_schema import empty_fragment, empty_person_fragment

from . import _pdf

SHAPE = "doggie_dashboard_reports"

FOOTER = "DoggieDashboard.com"
# "Created on July 27, 2026" — the print date at the top of every report. It
# has to be named because it is shaped exactly like an owner record header.
MASTHEAD = re.compile(r"^Created on\s+\w+\s+\d{1,2},\s*\d{4}\s*$")

# ── Active Pets Information Report ───────────────────────────────────────────
# "Castiel (Cas) (Sadie Brudenall)" — the OWNER is the LAST bracketed group, so
# the pet part is matched greedily. A dog whose name carries a nickname in
# brackets is common enough that taking the first group instead would quietly
# reassign it to an owner called "Cas".
_PET_HEADER = re.compile(r"^(?P<pet>.+?)\s*\((?P<owner>[^()]+)\)\s*$")
_PET_FIELDS = ("Breed", "Sex", "Color", "Birthday", "Special Notes")

# ── Active Owners Information Report ─────────────────────────────────────────
# Matched against a closed list because one of the labels contains commas
# ("Emergency Contact, Second Owner, …") and the record header is itself
# "Last, First". Splitting on the first colon or the first comma gets one of
# the two wrong; knowing the labels gets both right.
_OWNER_LABELS = (
    "Address",
    "Phone Number",
    "Additional Phone",
    "Email Address",
    "Emergency Contact, Second Owner, Others Allowed to Pick Up Pets",
    "Family Vet Clinic",
    "Referral Source",
)
_OWNER_FIELD = re.compile(
    r"^(?P<label>" + "|".join(re.escape(x) for x in _OWNER_LABELS) + r"):\s*(?P<value>.*)$")

# ── Weekly Outlook ───────────────────────────────────────────────────────────
_APPT_OWNER = re.compile(r"^(?P<name>.*?)\s*\((?P<phone>[^()]*)\)\s*$")
# The separator is a "→" that `_pdf` renders as "!" (see its docstring).
_TIME_SPLIT = re.compile(r"\s*[→!]\s*")
_WEEKDAY = re.compile(
    r"\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b")
_DAY_ORDER = {d: i for i, d in enumerate(
    ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"))}

# A slot that is a note to staff rather than a group the dog belongs to.
_NON_GROUP_SLOTS = {"not here - add reason", "extra - not their regular day"}


def _lines(path: Path) -> list[str]:
    return _pdf.strip_chrome(_pdf.text_lines(path), footer=FOOTER,
                             masthead=MASTHEAD)


# ---------------------------------------------------------------------------
# Parsers — each returns plain dicts, so they can be reused (and tested)
# without going anywhere near a fragment.
# ---------------------------------------------------------------------------

def parse_pets(path: Path) -> list[dict]:
    """One record per ACTIVE dog: name, owner name, and everything known."""
    pets: list[dict] = []
    current: dict | None = None
    for line in _lines(path):
        if line.endswith("Report"):
            continue
        label, _, value = line.partition(":")
        known = label.strip() in _PET_FIELDS or label.strip().endswith("Expiration")
        if known and value.strip():
            if current is None:
                continue
            key = label.strip()
            if key.endswith("Expiration"):
                current["vaccinations"][key[:-len("Expiration")].strip()] = value.strip()
            else:
                current[key.lower().replace(" ", "_")] = value.strip()
            continue
        m = _PET_HEADER.match(line)
        if m:
            current = {
                "pet": m.group("pet").strip(),
                "owner": m.group("owner").strip(),
                "breed": "", "sex": "", "color": "", "birthday": "",
                "special_notes": "", "vaccinations": {},
            }
            pets.append(current)
    return pets


def parse_owners(path: Path) -> list[dict]:
    """One record per ACTIVE owner, keyed the way the report prints them."""
    owners: list[dict] = []
    current: dict | None = None
    for line in _lines(path):
        if line.endswith("Report"):
            continue
        m = _OWNER_FIELD.match(line)
        if m and current is not None:
            current["fields"][m.group("label")] = m.group("value").strip()
            continue
        if "," in line and not m:
            last, _, first = line.partition(",")
            current = {"last": last.strip(), "first": first.strip(), "fields": {}}
            owners.append(current)
    return owners


def parse_appointments(path: Path) -> list[dict]:
    """One record per booking in the week the report covers."""
    appts: list[dict] = []
    current: dict | None = None
    for line in _lines(path):
        label, _, value = line.partition(":")
        label, value = label.strip(), value.strip()
        if label == "Pet":
            pet, _, breed = value.partition("|")
            current = {"pet": pet.strip(), "breed": breed.strip(), "owner": "",
                       "phone": "", "start": "", "end": "", "weekday": "",
                       "slot": "", "type": ""}
            appts.append(current)
        elif current is None:
            continue
        elif label == "Owner":
            m = _APPT_OWNER.match(value)
            current["owner"] = (m.group("name") if m else value).strip()
            current["phone"] = (m.group("phone") if m else "").strip()
        elif label == "Times":
            parts = _TIME_SPLIT.split(value)
            current["start"] = parts[0].strip()
            current["end"] = parts[1].strip() if len(parts) > 1 else ""
            day = _WEEKDAY.search(current["start"])
            current["weekday"] = day.group(1) if day else ""
        elif label == "Slot":
            current["slot"] = value
        elif label == "Type":
            current["type"] = value
    return appts


def pet_index(path: Path) -> dict[str, list[str]]:
    """
    Owner name → the names of their active dogs, for the CSV module.

    This is the whole reason the two modules know about each other. The CSV's
    `Pets` column is a run-together list with no delimiter; the only reliable
    way to find the boundaries is to already know what the dogs are called.
    Both modules therefore read the pet names through this one function, so
    the names used to SPLIT the column are by construction the same names the
    pets report imports — the "teaches from one reading, parses with another"
    trap that `README-extract.md` warns about.
    """
    index: dict[str, list[str]] = defaultdict(list)
    for pet in parse_pets(path):
        index[parsing.norm_name(pet["owner"])].append(pet["pet"])
    return dict(index)


# ---------------------------------------------------------------------------
# The source-module interface
# ---------------------------------------------------------------------------

def vocabulary(path: Path, options: dict) -> dict:
    """
    The pets report is the best breed teacher in the whole client folder: one
    breed per dog, written by the person who owns the dog. The CSV has none.
    """
    report = (options.get("report") or "").lower()
    if report == "pets":
        return {"breeds": [p["breed"] for p in parse_pets(path) if p["breed"]],
                "suburbs": set()}
    if report == "appointments":
        return {"breeds": [a["breed"] for a in parse_appointments(path) if a["breed"]],
                "suburbs": set()}
    return {"breeds": [], "suburbs": set()}


def extract(path: Path, options: dict, ctx) -> list[dict]:
    report = (options.get("report") or "").lower()
    if report == "pets":
        return _extract_pets(path, options, ctx)
    if report == "owners":
        return _extract_owners(path, options, ctx)
    if report == "appointments":
        return _extract_appointments(path, options, ctx)
    raise SystemExit(
        f"{SHAPE}: options.report must be pets|owners|appointments, "
        f"got {options.get('report')!r} for {path}")


def _person(label: str, name: str, source_key: str) -> dict:
    p = empty_person_fragment(label)
    p["name"] = name
    p["sourceKey"] = source_key
    return p


def _extract_pets(path: Path, options: dict, ctx) -> list[dict]:
    """
    Dogs, with everything the report knows, attached to owners BY NAME.

    Only `breed` has a column of its own in the destination. Sex, colour,
    birthday and the vaccination expiry dates are real, operationally
    important facts with nowhere structured to live, so they are written into
    the dog's notes rather than dropped — including the birthday, even though
    `Dog.dob` exists, because the plan has no field to carry it through.
    """
    label = options.get("label") or "pets_report"
    frag = empty_fragment(label)
    # A name match here is the expected outcome, not a surprise: this is the
    # same business's own report about the same people as the CSV.
    frag["announceNameMatch"] = False
    frag["messages"] = {
        "twinKind": "Dog in the pets report whose owner is not in the owner file",
        "twinDetail": ("The Active Pets report lists dogs for {twinName}, who "
                       "could not be matched to a row in the owner CSV. Kept as "
                       "a separate person ({personId}) — check."),
    }

    by_owner: dict[str, list[dict]] = defaultdict(list)
    for pet in parse_pets(path):
        by_owner[pet["owner"]].append(pet)

    for owner, pets in by_owner.items():
        p = _person(label, owner, f"{label}::{owner}")
        for pet in pets:
            # The merge engine drops a pet whose name is on the client's junk
            # list (requireName, below). Ask the same question here so this
            # module does not raise review notes about a record that is never
            # going to become a dog — "Retail Product Sale has no vaccination
            # dates" is true, and useless.
            if parsing.dog_name_junk_reason(
                    pet["pet"], breed_vocab=getattr(ctx, "breed_vocab", set()),
                    rules=ctx.config.junk, aliases=ctx.config.breed_aliases):
                continue
            detail = []
            if pet["sex"]:
                detail.append(f"Sex: {pet['sex']}")
            if pet["color"]:
                detail.append(f"Colour: {pet['color']}")
            if pet["birthday"]:
                detail.append(f"Date of birth: {pet['birthday']}")
            for vaccine, expires in pet["vaccinations"].items():
                detail.append(f"{vaccine} expires {expires}")
            if pet["special_notes"]:
                detail.append(f"Special notes: {pet['special_notes']}")
            p["dogs"].append({
                "name": pet["pet"],
                "breed": pet["breed"],
                "note": "; ".join(detail),
                # Judged like every other dog name so the client's junk
                # blocklist still applies — DoggieDashboard lets a non-dog be
                # created as a pet, and this client has one.
                "judge": True,
                # …and if the name is refused, drop the record rather than
                # keeping a nameless dog built from its leftovers. A pet row
                # for a retail sale still carries a "breed" of NA and a sex,
                # which is more than enough to create a mystery dog nobody
                # can identify.
                "requireName": True,
                "where": "the Active Pets report",
            })
            if not pet["vaccinations"]:
                p["review"].append({
                    "kind": "Dog with no vaccination dates",
                    "who": owner,
                    "detail": (f"{pet['pet']} has no vaccination expiry dates in "
                               f"the Active Pets report. Check before the dog's "
                               f"next visit."),
                })
        frag["people"].append(p)
    return [frag]


def _extract_owners(path: Path, options: dict, ctx) -> list[dict]:
    """
    The owner report — same people as the CSV, plus the vet clinic.

    Everything here except the vet clinic also exists in the CSV, and the CSV
    holds it in separate columns rather than one run-together address string,
    so the config gives the CSV precedence and this file backfills. The vet
    clinic exists nowhere else at all.
    """
    label = options.get("label") or "owners_report"
    vet_field = options.get("vetCustomField", "Family vet clinic")
    emergency_field = options.get("emergencyCustomField",
                                  "Emergency contact / second owner")
    referral_field = options.get("referralCustomField", "Referral source")
    phone2_field = options.get("additionalPhoneCustomField", "Additional phone")

    frag = empty_fragment(label)
    frag["announceNameMatch"] = False

    for owner in parse_owners(path):
        name = f"{owner['first']} {owner['last']}".strip()
        f = owner["fields"]
        p = _person(label, name, f"{label}::{owner['last']}, {owner['first']}")
        p["firstName"] = owner["first"]
        p["lastName"] = owner["last"]
        p["email"] = parsing.norm_email(f.get("Email Address"))
        p["phone"] = parsing.clean(f.get("Phone Number"))
        # The report prints the address as one line with the suburb already in
        # it. The CSV keeps them apart and wins, so this only ever lands for
        # somebody the CSV left blank.
        p["address"] = parsing.clean(f.get("Address"))
        for field, value in (
            (vet_field, f.get("Family Vet Clinic")),
            (emergency_field,
             f.get("Emergency Contact, Second Owner, Others Allowed to Pick Up Pets")),
            (referral_field, f.get("Referral Source")),
            (phone2_field, f.get("Additional Phone")),
        ):
            value = parsing.clean(value)
            if field and value:
                p["customFields"][field] = value
        frag["people"].append(p)
    return [frag]


def _extract_appointments(path: Path, options: dict, ctx) -> list[dict]:
    """
    Two weeks of bookings, read for what they say about the CLIENT.

    An individual booking on a particular Tuesday is not worth importing —
    the window is arbitrary (whatever fortnight was printed) and the plan has
    no shape for a daycare day. What IS durable, and what the daycare would
    otherwise have to reconstruct by hand, is: which days this dog comes,
    which group it goes in, and how the owner pays. Those are recorded.

    The bookings themselves are counted and summarised in the review so the
    decision is visible and reversible, rather than silently made.
    """
    label = options.get("label") or "appointments"
    days_field = options.get("daysCustomField", "Usual daycare days")
    group_field = options.get("groupCustomField", "Daycare group")
    type_field = options.get("typeCustomField", "Daycare booking type")
    window = options.get("window", "")

    frag = empty_fragment(label)
    frag["announceNameMatch"] = False

    appts = parse_appointments(path)
    by_owner: dict[str, list[dict]] = defaultdict(list)
    for a in appts:
        by_owner[a["owner"]].append(a)

    for owner, rows in by_owner.items():
        p = _person(label, owner, f"{label}::{owner}")
        p["phone"] = parsing.clean(rows[0]["phone"])

        days = sorted({r["weekday"] for r in rows if r["weekday"]},
                      key=lambda d: _DAY_ORDER.get(d, 99))
        groups = sorted({r["slot"] for r in rows
                         if r["slot"] and r["slot"].lower() not in _NON_GROUP_SLOTS})
        types = sorted({r["type"] for r in rows if r["type"]})
        for field, value in ((days_field, ", ".join(days)),
                             (group_field, ", ".join(groups)),
                             (type_field, ", ".join(types))):
            if field and value:
                p["customFields"][field] = value

        # Per dog, so a two-dog household that splits Little/Big is not
        # flattened into one meaningless "Little Dogs, Big Dogs".
        per_dog: dict[str, list[dict]] = defaultdict(list)
        for r in rows:
            per_dog[r["pet"]].append(r)
        for pet, pet_rows in per_dog.items():
            pet_days = sorted({r["weekday"] for r in pet_rows if r["weekday"]},
                              key=lambda d: _DAY_ORDER.get(d, 99))
            pet_group = sorted({r["slot"] for r in pet_rows
                                if r["slot"] and r["slot"].lower() not in _NON_GROUP_SLOTS})
            detail = []
            if pet_days:
                detail.append(f"Attends {', '.join(pet_days)}")
            if pet_group:
                detail.append(f"Group: {', '.join(pet_group)}")
            if window:
                detail.append(f"seen in the {window} outlook")
            p["dogs"].append({
                "name": pet,
                "breed": pet_rows[0]["breed"],
                "note": "; ".join(detail),
                "judge": True,
                "requireName": True,
                "where": "the weekly outlook",
            })
        frag["people"].append(p)

    frag["needsReview"].append({
        "kind": "Appointments read from this report",
        "who": window or path.name,
        "detail": (
            f"{len(appts)} appointments across {len(by_owner)} owners were read "
            f"from this report. Each client's usual days, group and booking type "
            f"are saved on their record here. The bookings themselves become "
            f"daycare day-parts and day bookings, which are loaded separately by "
            f"build_daycare.py and import-daycare.ts — the main import does not "
            f"carry them."),
    })
    return [frag]
