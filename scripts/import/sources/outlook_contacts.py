"""
Source shape: an OUTLOOK (or Google/Apple) CONTACTS export.

WHAT THIS SHAPE LOOKS LIKE
--------------------------
Ninety columns, most of them empty, and one column called Notes holding a
multi-line blob that is the real content — years of history typed by hand into
a contact card:

    Teddy - Yorkshire Terrier
    SP's January 2026 - The Welsh Corgi's
    DTP November 2024
    Lock box code 4821
    Intern, summer 2025

That blob is usually the ONLY place the dogs, the previous classes, the 1:1
services and the access codes are written down. Ignore it and you import a
contact list; parse it and you import a business.

WHY THE COLUMNS ARE PICKED BY NAME, IN PRIORITY ORDER
-----------------------------------------------------
A contacts export has nine phone columns and three address blocks, mostly
blank, filled in whichever one the user happened to click that day. There is
no "the" phone column. So we take the first non-empty one in a priority order
the client can tune, and record WHICH column it came from so a surprise is
traceable.

WHY IT NEEDS TO RUN AFTER THE SPREADSHEET
-----------------------------------------
Deciding whether "Teddy - Yorkshire Terrier" is a dog needs to know what this
client's breeds look like; deciding whether a bare "Pyes Pa" line is an
address needs to know their suburbs. Both vocabularies are learned from the
file the orchestrator processed first. A contacts file on its own still works
— it just classifies fewer lines confidently and puts more into freeText,
which is the safe direction.
"""

from __future__ import annotations

import csv
import re
from pathlib import Path

from lib import parsing
from lib.plan_schema import empty_course_ref, empty_fragment, empty_person_fragment

SHAPE = "outlook_contacts"

csv.field_size_limit(10 ** 7)

DEFAULT_PHONE_COLUMNS = (
    "Mobile Phone", "Business Phone", "Other Phone", "Primary Phone",
    "Home Phone", "Business Phone 2", "Home Phone 2", "Car Phone",
    "Company Main Phone",
)
DEFAULT_ADDRESS_PREFIXES = ("Other", "Home", "Business")

ADDRESS_LINE_RE = re.compile(r"^Address\s*(?:\([^)]*\))?\s*:\s*(.+)$", re.M | re.I)


def _rows(path: Path) -> list[dict]:
    with path.open(newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def pick_phone(row: dict, columns=DEFAULT_PHONE_COLUMNS) -> tuple[str, str]:
    for col in columns:
        v = (row.get(col) or "").strip()
        if v:
            return v, col
    return "", ""


def pick_address(row: dict, prefixes=DEFAULT_ADDRESS_PREFIXES) -> dict:
    for prefix in prefixes:
        street = (row.get(f"{prefix} Street") or "").strip()
        city = (row.get(f"{prefix} City") or "").strip()
        postcode = (row.get(f"{prefix} Postal Code") or "").strip()
        if street or city or postcode:
            return {"street": street, "city": city, "postcode": postcode,
                    "source": prefix}
    return {"street": "", "city": "", "postcode": "", "source": ""}


def vocabulary(path: Path, options: dict) -> dict:
    """Suburbs this file knows about — its city columns and its address lines."""
    suburbs = set()
    for row in _rows(path):
        for col in options.get("cityColumns") or ("Other City", "Home City",
                                                  "Business City"):
            v = parsing.norm_name(row.get(col))
            if v:
                suburbs.add(v)
        for m in ADDRESS_LINE_RE.finditer(row.get(options.get("notesColumn", "Notes")) or ""):
            v = parsing.norm_name(m.group(1))
            if v and len(v.split()) <= 3:
                suburbs.add(v)
    suburbs.discard("")
    return {"breeds": [], "suburbs": suburbs}


def extract(path: Path, options: dict, ctx) -> list[dict]:
    label = options.get("label") or "contacts"
    notes_col = options.get("notesColumn", "Notes")
    phone_cols = tuple(options.get("phoneColumns") or DEFAULT_PHONE_COLUMNS)
    addr_prefixes = tuple(options.get("addressPrefixes") or DEFAULT_ADDRESS_PREFIXES)

    grammar = ctx.grammar
    breed_vocab = ctx.breed_vocab
    suburb_vocab = ctx.suburb_vocab
    aliases = ctx.breed_aliases

    frag = empty_fragment(label)
    frag["messages"] = {
        "nameMatchKind": "Contact matched on name, not email",
        "nameMatchDetail": (
            "The contact card <{email}> was merged into '{personName}' "
            "({personId}) whose email is <{personEmail}> — same name, two "
            "addresses. Check."),
        "twinKind": "Contact with no email — possible duplicate",
        "twinDetail": (
            "This contact card has no email address, so it was kept as its own "
            "person ({personId}) with a placeholder address. '{twinName}' "
            "({twinId}, {twinEmail}) has the same name and is probably the "
            "same person — merge them if you agree."),
    }

    for i, row in enumerate(_rows(path), start=2):     # 2 = first data row
        if not any((v or "").strip() for v in row.values()):
            continue                                   # a truly blank card

        first = (row.get("First Name") or "").strip()
        last = (row.get("Last Name") or "").strip()
        full = f"{first} {last}".strip()
        email = parsing.norm_email(row.get("E-mail Address"))
        email2 = parsing.norm_email(row.get("E-mail 2 Address"))
        phone, phone_col = pick_phone(row, phone_cols)
        addr = pick_address(row, addr_prefixes)
        notes_raw = row.get(notes_col) or ""
        parsed = parsing.parse_notes(notes_raw, grammar, breed_vocab=breed_vocab,
                                     suburb_vocab=suburb_vocab, aliases=aliases)

        p = empty_person_fragment(label)
        p["name"] = full
        p["firstName"] = first
        p["lastName"] = last
        p["email"] = email
        p["phone"] = phone
        p["city"] = addr["city"]
        p["postcode"] = addr["postcode"]
        p["company"] = (row.get("Company") or "").strip()
        p["address"] = ", ".join(x for x in [addr["street"], addr["city"]] if x)
        p["sourceKey"] = f"contact::{full}::{i}"
        p["sourceRow"] = str(i)
        p["extra"] = {"phoneColumn": phone_col, "street": addr["street"],
                      "notesRaw": notes_raw}
        # Rule 3 in lib/dedup.py — a card with no address may never merge.
        p["neverMerge"] = not email

        if email2 and email2 != email:
            p["otherEmails"].append(email2)
            p["notes"].append(f"Second email on the contact card: {email2}")

        for d in parsed["dogs"]:
            p["dogs"].append({
                "name": parsing.clean(d.get("name")),
                "breed": parsing.clean(d.get("breed")),
                "note": parsing.clean(d.get("note")),
                "deceased": bool(d.get("deceased")),
                "deceasedAt": (parsing.parse_dmy(d.get("note")) or "unknown")
                              if d.get("deceased") else None,
                "judge": False,
                "where": "the contact card",
            })

        for c in parsed["courses"]:
            ref = empty_course_ref()
            ref.update({
                "code": c.get("code") or "", "month": c.get("month"),
                "year": c.get("year"), "nickname": c.get("nickname"),
                "nicknameKey": c.get("nicknameKey"),
                "dog": parsing.clean(c.get("dog")),
                "raw": parsing.clean(c.get("raw")),
                "comment": c.get("comment"),
                "priorProvider": bool(c.get("priorProvider")),
                "didNotAttend": bool(c.get("didNotAttend")),
            })
            p["courseRefs"].append(ref)

        p["consults"] = [dict(s) for s in parsed["oneToOne"]]
        p["roles"] = [dict(r) for r in parsed["roles"]]
        p["credits"] = list(parsed["credits"])
        p["accessCodes"] = list(parsed["accessCodes"])
        p["afRefs"] = [dict(a) for a in parsed["afRefs"]]
        p["addressHints"] = list(parsed["addressHints"])
        # Rule: nothing is silently dropped. Both buckets go onto the person.
        p["unclassified"] = list(parsed["unclassified"])
        p["freeText"] = list(parsed["freeText"])

        # A death-adjacent word that produced no deceased dog is worth a human
        # glance — "Rip" is also a perfectly good dog's name.
        if (re.search(r"\bPTS\b|passed away|\bdied\b|\bRIP\b", notes_raw, re.I)
                and not any(d.get("deceased") for d in parsed["dogs"])):
            head = (notes_raw.splitlines() or [""])[0]
            p["review"].append({
                "kind": "Might mention a dog that has died", "who": full,
                "detail": f"The contact card says: {head!r}. No dog was marked "
                          f"as died — check whether it should be."})

        frag["people"].append(p)

    return [frag]
