"""
The source-shape registry.

A "shape" is a KIND of file we have met before, not a particular client's
file. `outlook_contacts` is a shape; "Journey's contacts.csv" is an instance
of it. Onboarding a new client is mostly a matter of saying which of their
files is which shape — and only occasionally of adding a shape here.

Every shape module exposes the same three things:

    SHAPE       str — the name used in a client config's `files[].shape`
    vocabulary(path, options) -> {"breeds": [...], "suburbs": {...}}
                a cheap first pass. What this file can teach LATER files about
                the client's own words. May return empty sets.
    extract(path, options, ctx) -> [fragment, ...]
                the real read. One file may emit several fragments when it
                holds several kinds of evidence (the booking spreadsheet emits
                its class sheets and its waitlist separately, because they are
                not equally reliable).

A fragment is ONE FILE'S OPINION of some people — never a merged view. The
merge engine (lib/merge.py) is the only thing allowed to reconcile opinions,
which is what keeps a new shape from having to understand precedence.
"""

from __future__ import annotations

from . import (booking_spreadsheet, doggie_dashboard, doggie_dashboard_reports,
               outlook_contacts, simple_contacts, squarespace_profiles)

REGISTRY = {
    m.SHAPE: m for m in (
        booking_spreadsheet,
        doggie_dashboard,
        doggie_dashboard_reports,
        outlook_contacts,
        simple_contacts,
        squarespace_profiles,
    )
}


def get(shape: str):
    try:
        return REGISTRY[shape]
    except KeyError:
        raise SystemExit(
            f"unknown source shape {shape!r}. Known shapes: "
            + ", ".join(sorted(REGISTRY))
        ) from None


__all__ = ["REGISTRY", "get"]
