"""
Source shape: a FLAT LIST — Name / Phone / Business / Email / Group.

WHAT THIS SHAPE LOOKS LIKE
--------------------------
The smallest useful file a client ever sends: a hand-kept list with one row
per person and no history. In the first onboarding it was "pet-industry
professionals" — vets, groomers, breeders — a referral network the trainer
kept separately from her clients. Other clients will send the same shape for
committee members, staff, or a partner organisation.

WHY IT IS ITS OWN SHAPE
-----------------------
Because of what it MEANS, not what it looks like. A row here is an assertion
about a person's ROLE, and roles behave differently from contact details:

1. **The person usually already exists.** A vet who also brings her own dog to
   class is one human with two hats. Merging is the point, not a risk.

2. **The role is exclusive.** Two professionals sharing one email address —
   a husband and wife running one business off one mailbox — are two people
   with two businesses. So a fragment can claim an EXCLUSIVE role, and the
   second claimant gets their own record and a review note rather than
   silently overwriting the first one's business name.

3. **An email match is not enough on its own.** If the row is "Annie Black"
   and the client on that address is "Ryan Black", the email is shared, not
   the identity. `requireCompatibleName` makes the engine demand that the two
   names could plausibly be the same person before merging.

Column names are config, so "Business" can be "Company" and "Group" can be
"Category" without touching this file.
"""

from __future__ import annotations

import csv
from pathlib import Path

from lib import parsing
from lib.plan_schema import empty_fragment, empty_person_fragment

SHAPE = "simple_contacts"

DEFAULT_COLUMNS = {
    "name": "Name",
    "email": "Email",
    "phone": "Phone",
    "business": "Business",
    "group": "Group",
}


def _rows(path: Path) -> list[dict]:
    with path.open(newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def vocabulary(path: Path, options: dict) -> dict:
    return {"breeds": [], "suburbs": set()}


def extract(path: Path, options: dict, ctx) -> list[dict]:
    label = options.get("label") or "professionals"
    cols = {**DEFAULT_COLUMNS, **(options.get("columns") or {})}
    role_label = options.get("roleCustomField", ctx.custom_field("professional"))
    business_label = options.get("businessCustomField", ctx.custom_field("business"))
    exclusive = options.get("exclusiveClaim", "professional")
    group_note = options.get("groupNotePrefix", "Professional group")

    frag = empty_fragment(label)
    frag["messages"] = {
        "exclusiveKind": f"Two {label} share one email",
        "exclusiveDetail": (
            "{name} shares {email} with {personName}. Kept as two separate "
            "people, both using that email address."),
        "incompatibleKind": "Name does not match the client on that email",
        "incompatibleDetail": (
            "{name} <{email}> matched the client '{personName}'. Kept as "
            "separate people — check."),
    }
    seen: set[tuple[str, str]] = set()

    for row in _rows(path):
        name = parsing.clean(row.get(cols["name"]))
        email = parsing.norm_email(row.get(cols["email"]))
        key = (email, parsing.norm_name(name))
        if key in seen:
            # The same person listed twice. One row, not two records.
            frag["needsReview"].append({
                "kind": f"Duplicate row in {label}", "who": name,
                "detail": f"{name} <{email}> is listed more than once; the "
                          f"repeat rows were ignored."})
            continue
        seen.add(key)

        p = empty_person_fragment(label)
        p["name"] = name
        p["email"] = email
        p["phone"] = parsing.clean(row.get(cols["phone"]))
        p["sourceKey"] = f"{label}::{name}"
        p["claimsExclusive"] = exclusive
        p["requireCompatibleName"] = True
        if role_label:
            p["customFields"][role_label] = "Yes"
        business = parsing.clean(row.get(cols["business"]))
        if business and business_label:
            p["customFields"][business_label] = business
        group = parsing.clean(row.get(cols["group"]))
        if group:
            p["notes"].append(f"{group_note}: {group}")
        p["extra"] = {"row": dict(row)}
        frag["people"].append(p)

    return [frag]
