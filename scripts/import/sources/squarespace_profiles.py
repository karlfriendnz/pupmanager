"""
Source shape: a WEBSITE / MAILING-LIST PROFILE export (Squarespace, Shopify,
Mailchimp — same idea, different column names).

WHAT THIS SHAPE LOOKS LIKE
--------------------------
One row per email address that has ever signed up, with a name the customer
typed themselves, a marketing-consent flag, a signup date, and sometimes a
billing address and order history.

WHY IT IS THE LOWEST-PRIORITY SOURCE, AND STILL ESSENTIAL
---------------------------------------------------------
Lowest priority because it is the least curated: the name is whatever the
customer typed into a website form at 11pm, and it is the file most likely to
hold "asdf" in the surname field. It must never overwrite a name the business
itself wrote down.

Essential because of who is ONLY in it. In the first onboarding, 153 of 583
subscribers had never taken a class. They are not clients — they are the
mailing list, which is the client's marketing asset, and dropping them because
they have no class history would quietly delete a quarter of the business's
reach.

So every row becomes a person, and `isSubscriber` marks them. Whether the
loader creates a full client record or just a marketing contact is the
loader's decision, made from a flag rather than from an absence.

THE CONSENT FLAG IS CARRIED VERBATIM
------------------------------------
`acceptsMarketing` is copied as the source wrote it and never inferred.
Guessing consent is the one mistake in an import with legal consequences.
"""

from __future__ import annotations

import csv
from pathlib import Path

from lib import parsing
from lib.plan_schema import empty_fragment, empty_person_fragment

SHAPE = "squarespace_profiles"

DEFAULT_COLUMNS = {
    "email": "Email",
    "firstName": "First Name",
    "lastName": "Last Name",
    "phone": ["Billing Phone Number", "Shipping Phone Number"],
    "addressLine": "Billing Address 1",
    "city": "Billing City",
    "createdOn": "Created On",
    "subscriberSince": "Subscriber Since",
    "subscriberSource": "Subscriber Source",
    "acceptsMarketing": "Accepts Marketing",
    "orderCount": "Order Count",
    "totalSpent": "Total Spent",
}


def _rows(path: Path) -> list[dict]:
    with path.open(newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def _first(row: dict, cols) -> str:
    if isinstance(cols, str):
        cols = [cols]
    for c in cols:
        v = parsing.clean(row.get(c))
        if v:
            return v
    return ""


def vocabulary(path: Path, options: dict) -> dict:
    return {"breeds": [], "suburbs": set()}


def extract(path: Path, options: dict, ctx) -> list[dict]:
    label = options.get("label") or "subscribers"
    cols = {**DEFAULT_COLUMNS, **(options.get("columns") or {})}

    frag = empty_fragment(label)
    frag["messages"] = {
        "nameMatchKind": "Subscriber matched on name, not email",
        "nameMatchDetail": (
            "The mailing list has {name} <{email}> but this person's email is "
            "<{personEmail}>. Probably the same person with a typo — merged. "
            "Check."),
        "nameMatchNote": "Also subscribes with the email {email}",
    }
    for row in _rows(path):
        email = parsing.norm_email(row.get(cols["email"]))
        first = parsing.clean(row.get(cols["firstName"]))
        last = parsing.clean(row.get(cols["lastName"]))

        p = empty_person_fragment(label)
        p["name"] = " ".join(x for x in [first, last] if x)
        p["firstName"] = first
        p["lastName"] = last
        p["email"] = email
        p["phone"] = _first(row, cols["phone"])
        p["address"] = ", ".join(x for x in [
            parsing.clean(row.get(cols["addressLine"])),
            parsing.clean(row.get(cols["city"]))] if x)
        p["sourceKey"] = f"{label}::{email or p['name']}"
        p["subscriber"] = {
            "email": email,
            "createdOn": parsing.clean(row.get(cols["createdOn"])),
            "subscriberSince": parsing.clean(row.get(cols["subscriberSince"])),
            "source": parsing.clean(row.get(cols["subscriberSource"])),
            "acceptsMarketing": parsing.clean(row.get(cols["acceptsMarketing"])),
            "orderCount": parsing.clean(row.get(cols["orderCount"])),
            "totalSpent": parsing.clean(row.get(cols["totalSpent"])),
        }
        frag["people"].append(p)

    return [frag]
