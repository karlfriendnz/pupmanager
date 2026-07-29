"""
Source shape: a DOGGIEDASHBOARD owner export (CSV).

WHAT THIS SHAPE LOOKS LIKE
--------------------------
One row per owner, from a US-built daycare product. Seventeen fixed columns:

    First Name, Last Name, Pets, Phone, Mobile Phone, Email, Address, City,
    State, Zip, Secondary Owner/Emergency Contact, Referral Source, Notes,
    Custom Owner Field 1-3, Date Added

It is the only machine-readable file DoggieDashboard gives you, and it is the
spine of the import — but it is thinner than it looks, and two of its columns
lie about what they hold.

THE TWO TRAPS
-------------
**`State` holds a SUBURB.** The form is American; the client is in Whanganui.
So the column offered for a state is where "Tawhero", "Gonville" and
"Castlecliff" ended up. Imported as a state it is nonsense; imported as part
of the address it is exactly right. `suburbColumnIsSuburb` (default true) is
what makes that explicit rather than a silent recode.

**`Pets` is every dog the household has ever had, run together with no
delimiter.** `Bubble Pipi` is two dogs. `Miss Daisy` is one. `Castiel (Cas)`
is one dog with a nickname. `Louie - Lab` and `Louie - Peters` are one dog
each — the dash is a disambiguator the business types to tell two Louies
apart, so it is not a breed separator either, and treating it as one produces
a dog called "Lab". `Ziggy Duke Retail Product Sale` is two dogs and a
transaction record that got created as a pet.

No rule over that column is safe, so this module does not invent one.

HOW THE `Pets` COLUMN IS ACTUALLY SPLIT
---------------------------------------
Not by guessing — by looking the names up. `options.petNamesFrom` points at
the Active Pets Information Report, whose records are one per dog, and the
column is split by consuming those known names longest-first. Every boundary
is then a fact from the client's own system rather than a heuristic, and what
is left over after the consuming is meaningful in its own right: a dog in the
owner file that the ACTIVE pets report does not list is a dog that has left.

Without `petNamesFrom` the module still runs, splitting on whitespace and
flagging every multi-dog cell for a human. That is a genuinely worse import,
which is why the config for this client supplies the report.
"""

from __future__ import annotations

import csv
import re
from pathlib import Path

from lib import parsing
from lib.plan_schema import empty_fragment, empty_person_fragment

from .doggie_dashboard_reports import pet_index

SHAPE = "doggie_dashboard"

DEFAULT_COLUMNS = {
    "firstName": "First Name",
    "lastName": "Last Name",
    "pets": "Pets",
    "phone": "Phone",
    "mobile": "Mobile Phone",
    "email": "Email",
    "address": "Address",
    "city": "City",
    "suburb": "State",
    "postcode": "Zip",
    "emergency": "Secondary Owner/Emergency Contact",
    "referral": "Referral Source",
    "notes": "Notes",
    "custom1": "Custom Owner Field 1",
    "custom2": "Custom Owner Field 2",
    "custom3": "Custom Owner Field 3",
    "dateAdded": "Date Added",
}

# The client's labels for the columns this product calls "Custom Owner Field
# N". They are per-client by definition, so they are config; these are only
# fallbacks so the module is runnable without them.
DEFAULT_CUSTOM_LABELS = {
    "custom1": "Authorised pick-up",
    "custom2": "Care instructions",
    "custom3": "Other notes",
}

_MONTHS = {m: i for i, m in enumerate(
    ("january", "february", "march", "april", "may", "june", "july",
     "august", "september", "october", "november", "december"), start=1)}
_DATE_ADDED = re.compile(r"^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$")


def _rows(path: Path) -> list[dict]:
    with path.open(newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def _iso_date(raw: str) -> str:
    """"September 26, 2023" -> "2023-09-26"; anything else comes back as-is."""
    m = _DATE_ADDED.match(parsing.clean(raw))
    if not m:
        return parsing.clean(raw)
    month = _MONTHS.get(m.group(1).lower())
    if not month:
        return parsing.clean(raw)
    return f"{m.group(3)}-{month:02d}-{int(m.group(2)):02d}"


def split_pets(cell: str, known: list[str]) -> tuple[list[str], list[str]]:
    """
    Split one `Pets` cell into (names confirmed by the report, everything else).

    Longest-first so a known `Castiel (Cas)` is consumed whole and cannot be
    left as a stray `(Cas)`, and so `Maggie - Lab` is taken before a bare
    `Maggie` could strand the ` - Lab`. Matching is on whole words and
    case-insensitive; the residue keeps the client's original spelling.
    """
    text = " " + re.sub(r"\s+", " ", parsing.clean(cell)) + " "
    confirmed: list[str] = []
    for name in sorted(known, key=len, reverse=True):
        pattern = re.compile(r"(?<=\s)" + re.escape(name) + r"(?=\s)", re.I)
        m = pattern.search(text)
        if m:
            confirmed.append(name)
            text = text[:m.start()] + " " + text[m.end():]
    residue = [t for t in text.split() if t]
    # Keep the report's own order, so two runs cannot disagree about which dog
    # is the household's primary one.
    confirmed.sort(key=lambda n: known.index(n))
    return confirmed, residue


def vocabulary(path: Path, options: dict) -> dict:
    """
    The export has no breed column at all, and its `City`/`State` columns are
    the only place some suburbs are written down.
    """
    cols = {**DEFAULT_COLUMNS, **(options.get("columns") or {})}
    suburbs = set()
    for row in _rows(path):
        for key in ("city", "suburb"):
            value = parsing.clean(row.get(cols[key]))
            if value:
                suburbs.add(value)
    return {"breeds": [], "suburbs": suburbs}


def extract(path: Path, options: dict, ctx) -> list[dict]:
    label = options.get("label") or "owners"
    cols = {**DEFAULT_COLUMNS, **(options.get("columns") or {})}
    labels = {**DEFAULT_CUSTOM_LABELS, **(options.get("customFieldLabels") or {})}
    emergency_field = options.get("emergencyCustomField",
                                  "Emergency contact / second owner")
    referral_field = options.get("referralCustomField", "Referral source")
    phone2_field = options.get("additionalPhoneCustomField", "Additional phone")
    since_field = options.get("clientSinceCustomField", "Client since")
    fold_suburb = options.get("suburbColumnIsSuburb", True)

    known_pets: dict[str, list[str]] = {}
    report = options.get("petNamesFrom")
    if report:
        report_path = Path(report).expanduser()
        if not report_path.is_absolute():
            report_path = path.parent / report_path
        if not report_path.exists():
            raise SystemExit(
                f"{SHAPE}: options.petNamesFrom points at {report_path}, "
                f"which does not exist")
        known_pets = pet_index(report_path)

    frag = empty_fragment(label)
    frag["messages"] = {
        "twinKind": "Owner with no email address",
        "twinDetail": ("This owner has no email address in the DoggieDashboard "
                       "export, so they were kept as their own person "
                       "({personId}) with a stand-in address. '{twinName}' "
                       "({twinId}, {twinEmail}) has the same name and may be "
                       "the same person — merge them if you agree."),
    }

    for index, row in enumerate(_rows(path), start=2):   # row 1 is the header
        first = parsing.clean(row.get(cols["firstName"]))
        last = parsing.clean(row.get(cols["lastName"]))
        name = f"{first} {last}".strip()
        email = parsing.norm_email(row.get(cols["email"]))

        p = empty_person_fragment(label)
        p["name"] = name
        p["firstName"] = first
        p["lastName"] = last
        p["email"] = email
        p["sourceRow"] = f"row {index}"
        # The seed for a stand-in address. It must be stable across runs and
        # unique per person, and the row number is neither on its own — a name
        # is what survives the client re-exporting in a different order.
        p["sourceKey"] = f"{label}::{name or index}"
        p["phone"] = parsing.clean(row.get(cols["phone"]))

        # No address anywhere means this person must never merge into anyone
        # (lib/dedup rule 3) — six of them here.
        if not email:
            p["neverMerge"] = True

        address = parsing.clean(row.get(cols["address"]))
        suburb = parsing.clean(row.get(cols["suburb"]))
        if fold_suburb and suburb:
            # The suburb belongs in the address, not in a state field the
            # destination does not have. Only appended when it is not already
            # spelled out in the address or the city.
            city = parsing.clean(row.get(cols["city"]))
            seen = parsing.norm_name(f"{address} {city}")
            if parsing.norm_name(suburb) not in seen:
                address = f"{address}, {suburb}".strip(" ,")
        p["address"] = address
        p["city"] = parsing.clean(row.get(cols["city"]))
        p["postcode"] = parsing.clean(row.get(cols["postcode"]))

        mobile = parsing.clean(row.get(cols["mobile"]))
        if mobile and not parsing.values_agree("phone", p["phone"], mobile,
                                               ctx.config.phone):
            p["customFields"][phone2_field] = mobile

        for field, value in (
            (emergency_field, row.get(cols["emergency"])),
            (referral_field, row.get(cols["referral"])),
            (labels.get("custom1"), row.get(cols["custom1"])),
            (labels.get("custom2"), row.get(cols["custom2"])),
            (labels.get("custom3"), row.get(cols["custom3"])),
        ):
            value = parsing.clean(value)
            if field and value:
                # These columns hold several lines (two authorised people, a
                # name and a number each). One cell, one value.
                p["customFields"][field] = " · ".join(
                    x.strip() for x in re.split(r"[\r\n]+", value) if x.strip())

        since = _iso_date(row.get(cols["dateAdded"]) or "")
        if since and since_field:
            p["customFields"][since_field] = since

        # The column is empty for every row in this client's export, but an
        # export is a moving target and a note is not something to lose.
        for line in re.split(r"[\r\n]+", parsing.clean(row.get(cols["notes"])) or ""):
            if line.strip():
                p["notes"].append(line.strip())

        _attach_dogs(p, row.get(cols["pets"]), name, known_pets, bool(report),
                     frag, ctx)
        p["extra"] = {"row": dict(row)}
        frag["people"].append(p)

    return [frag]


def _attach_dogs(p: dict, cell, owner: str, known_pets: dict[str, list[str]],
                 have_report: bool, frag: dict, ctx) -> None:
    """
    Turn one `Pets` cell into dog fragments, saying how sure we are of each.

    Every cell that turns into more than one dog is announced, per the rule
    that a split is a decision a human should be able to disagree with. What
    the announcement SAYS differs, though, and the difference is the point: a
    split the pets report confirms is a fact being reported, and a split made
    without it is a guess being flagged.
    """
    cell = parsing.clean(cell)
    if not cell:
        return

    known = known_pets.get(parsing.norm_name(owner), [])
    confirmed, residue = split_pets(cell, known)

    if not have_report:
        # No report to check against: whitespace is the only separator there
        # is, and every one of these is a guess.
        names = [t for t in cell.split() if t]
        for name in names:
            p["dogs"].append({"name": name, "breed": "", "judge": True,
                              "requireName": True,
                              "where": "the Pets column"})
        if len(names) > 1:
            frag["needsReview"].append({
                "kind": "Pets column split without a pets report",
                "who": owner,
                "detail": (f"'{cell}' was split into {len(names)} dogs on the "
                           f"spaces because no Active Pets report was supplied. "
                           f"This is a guess — check it."),
            })
        return

    for name in confirmed:
        # Named in the client's own Active Pets report, so the split is a fact
        # rather than a guess; the report module carries its breed and detail.
        # Still judged, because the report is where the junk record lives too.
        p["dogs"].append({"name": name, "breed": "", "judge": True,
                          "requireName": True,
                          "where": "the Pets column"})

    for name in residue:
        p["dogs"].append({"name": name, "breed": "", "judge": True,
                          "requireName": True,
                          "where": "the Pets column (not in the pets report)"})

    # The review note must name the dogs that will actually be imported. The
    # judge runs later (in the merge engine) and throws out anything on the
    # client's junk list, so a note written from `confirmed` alone would
    # cheerfully announce "Retail Product Sale" as one of somebody's dogs.
    # Asking the same question here, with the same rules, keeps the two honest.
    real = [n for n in confirmed
            if not parsing.dog_name_junk_reason(
                n, breed_vocab=getattr(ctx, "breed_vocab", set()),
                rules=ctx.config.junk, aliases=ctx.config.breed_aliases)]

    if len(real) > 1:
        frag["needsReview"].append({
            "kind": "One Pets cell became several dogs",
            "who": owner,
            "detail": (f"'{cell}' was read as {len(real)} dogs: "
                       f"{', '.join(real)}. Each one is a separate record "
                       f"in the client's own Active Pets report, so the split "
                       f"matches their system."),
        })

    if residue:
        frag["needsReview"].append({
            "kind": "Dog in the owner file but not in the active pets report",
            "who": owner,
            "detail": (f"'{cell}' also contains {', '.join(residue)}, which the "
                       f"Active Pets report does not list. Probably a dog that "
                       f"has left or died — imported with no breed or "
                       f"vaccination detail, because there is none to import."),
        })
