"""
The person registry — who exists, and which file wins each field.

WHY THIS EXISTS
---------------
Four files describe overlapping sets of the same humans, and every one of them
is partly wrong. The spreadsheet has the class history but drops surnames. The
contacts export has the dogs and the addresses but is two years stale on phone
numbers. The mailing list has a name typed by the customer themselves. None is
authoritative about everything.

So a Person here is not a row from a file. It is an accumulation, and every
field carries:

  * its VALUE,
  * its PROVENANCE (which file it came from),
  * and, when two files disagreed, an OVERRIDE record naming what was set
    aside and why.

That last part is the whole point. A merge that quietly discards data is
indistinguishable from a bug. A merge that writes down "kept 021…, set aside
027… (spreadsheet beats contacts)" can be reviewed in a workbook by the person
who actually knows which number still works.

PRECEDENCE
----------
Sources have integer priorities, from config. Higher wins a straight
disagreement. Two exceptions are hard-coded because they are not preferences,
they are logic:

  * an EMPTY value never overrides anything — it is a gap, not an opinion;
  * a PLACEHOLDER email never beats a real one, whatever the priority, and
    losing that fight is not recorded as a conflict, because an address we
    invented ourselves was never evidence.
"""

from __future__ import annotations

from collections import defaultdict

from .dedup import is_placeholder
from .text import (NZ_PHONE, PhoneRules, breeds_agree, clean, norm_email,
                   norm_name, values_agree)


class Person:
    __slots__ = ("id", "fields", "provenance", "overrides", "dogs", "enrolments",
                 "consults", "custom", "notes", "access_codes", "af_refs",
                 "waitlist", "sources", "flags", "subscriber", "exclusive",
                 "extra", "other_emails")

    def __init__(self, pid: str) -> None:
        self.id = pid
        self.fields: dict[str, str] = {}
        self.provenance: dict[str, str] = {}
        self.overrides: list[dict] = []
        self.dogs: list[dict] = []
        self.enrolments: list[dict] = []
        self.consults: list[dict] = []
        self.custom: dict[str, str] = {}
        self.notes: list[str] = []
        self.access_codes: list[str] = []
        self.af_refs: list[dict] = []
        self.waitlist: list[dict] = []
        self.sources: list[str] = []
        self.flags: list[str] = []
        self.subscriber: dict | None = None
        # Claims that only one fragment per person may make (see the
        # "two professionals share one email" case in the README).
        self.exclusive: set[str] = set()
        self.extra: dict = {}
        self.other_emails: list[str] = []

    # -- accumulation ------------------------------------------------------

    def add_other_email(self, email: str) -> None:
        """Keep a real address that lost a precedence fight. It still reaches them."""
        e = norm_email(email)
        if (e and not is_placeholder(e)
                and e != norm_email(self.fields.get("email", ""))
                and e not in self.other_emails):
            self.other_emails.append(e)

    def set_field(self, field: str, value, source: str, registry: "Registry") -> None:
        v = clean(value)
        if not v:
            return
        cur = self.fields.get(field, "")
        if not cur:
            self.fields[field] = v
            self.provenance[field] = source
            return
        if values_agree(field, cur, v, registry.phone_rules):
            return

        if field == "email":
            # An invented address is not evidence. A real one always wins, and
            # no conflict is recorded.
            if is_placeholder(cur) and not is_placeholder(v):
                self.fields[field] = v
                self.provenance[field] = source
                return
            if is_placeholder(v):
                return

        cur_src = self.provenance.get(field, "unknown")
        if registry.priority(source) > registry.priority(cur_src):
            kept, kept_src, dropped, dropped_src = v, source, cur, cur_src
            self.fields[field] = v
            self.provenance[field] = source
        else:
            kept, kept_src, dropped, dropped_src = cur, cur_src, v, source

        if field == "email":
            self.add_other_email(dropped)

        entry = {
            "personId": self.id,
            "person": self.fields.get("name", ""),
            "field": field,
            "kept": kept,
            "keptFrom": kept_src,
            "discarded": dropped,
            "discardedFrom": dropped_src,
        }
        self.overrides.append(entry)
        registry.overrides.append(entry)

    def add_note(self, line, source: str) -> None:
        t = clean(line)
        if not t:
            return
        tagged = f"[{source}] {t}"
        if tagged not in self.notes:
            self.notes.append(tagged)

    def add_source(self, s: str) -> None:
        if s not in self.sources:
            self.sources.append(s)

    def add_flag(self, f: str) -> None:
        if f not in self.flags:
            self.flags.append(f)


class Registry:
    """
    Every person, indexed by the keys we are willing to match on.

    Email is indexed always. Name is indexed always but only CONSULTED when
    the caller allows it — a source that must never merge (a contact card with
    no email) passes `allow_name=False` and gets a fresh person every time.
    """

    def __init__(self, priorities: dict[str, int] | None = None,
                 phone_rules: PhoneRules = NZ_PHONE) -> None:
        self.people: list[Person] = []
        self.by_email: dict[str, Person] = {}
        self.by_name: dict[str, list[Person]] = defaultdict(list)
        self.overrides: list[dict] = []
        self.needs_review: list[dict] = []
        self.priorities = dict(priorities or {})
        self.phone_rules = phone_rules
        self._seq = 0

    def priority(self, source: str) -> int:
        return self.priorities.get(source, 0)

    def new_person(self, email: str, name: str) -> Person:
        self._seq += 1
        p = Person(f"P{self._seq:04d}")
        self.people.append(p)
        self.index(p, email, name)
        return p

    def index(self, p: Person, email: str, name: str) -> None:
        e = norm_email(email)
        if e and not is_placeholder(e) and e not in self.by_email:
            self.by_email[e] = p
        n = norm_name(name)
        if n and p not in self.by_name[n]:
            self.by_name[n].append(p)

    def find(self, email: str, name: str, *,
             allow_name: bool = True) -> tuple[Person | None, str]:
        e = norm_email(email)
        if e and not is_placeholder(e) and e in self.by_email:
            return self.by_email[e], "email"
        if allow_name:
            n = norm_name(name)
            if n and self.by_name.get(n):
                return self.by_name[n][0], "name"
        return None, ""

    def review(self, kind: str, who: str, detail: str) -> None:
        self.needs_review.append({"kind": kind, "who": who, "detail": detail})


# ---------------------------------------------------------------------------
# Dogs
# ---------------------------------------------------------------------------

def merge_dog(person: Person, *, name: str, breed: str, source: str,
              deceased_at: str | None = None, note: str = "",
              registry: Registry | None = None,
              aliases: dict[str, str] | None = None) -> None:
    """
    Fold one sighting of a dog into the person's list of dogs.

    Matching is deliberately generous in one direction only: a NAMELESS dog
    whose breed agrees adopts an incoming name (the spreadsheet routinely
    records a breed with no name, and the contacts file has the name), but two
    differently-named dogs never merge. A family with a Labrador called Ted
    and a Labrador called Bella must stay two dogs.
    """
    name, breed = clean(name), clean(breed)
    if not name and not breed and not note:
        return

    target = None
    if name:
        for d in person.dogs:
            if d["name"] and norm_name(d["name"]) == norm_name(name):
                target = d
                break
        if target is None:
            for d in person.dogs:
                if not d["name"] and breeds_agree(d.get("breed") or "", breed, aliases):
                    target = d
                    break
    else:
        for d in person.dogs:
            if breed and d.get("breed") and breeds_agree(d["breed"], breed, aliases):
                target = d
                break
        if target is None and len(person.dogs) == 1 and not person.dogs[0]["name"]:
            target = person.dogs[0]

    if target is None:
        target = {"name": "", "breed": "", "deceasedAt": None, "notes": [],
                  "sources": [], "provenance": {}, "flags": []}
        person.dogs.append(target)

    for field, value in (("name", name), ("breed", breed)):
        if not value:
            continue
        cur = target[field]
        if not cur:
            target[field] = value
            target["provenance"][field] = source
            continue
        if field == "breed" and breeds_agree(cur, value, aliases):
            continue
        if field == "name" and norm_name(cur) == norm_name(value):
            continue

        cur_src = target["provenance"].get(field, "unknown")
        prio = registry.priority if registry else (lambda s: 0)
        if prio(source) > prio(cur_src):
            kept, kept_src, dropped, dropped_src = value, source, cur, cur_src
            target[field] = value
            target["provenance"][field] = source
        else:
            kept, kept_src, dropped, dropped_src = cur, cur_src, value, source

        entry = {
            "personId": person.id,
            "person": person.fields.get("name", ""),
            "field": f"dog.{field}",
            "kept": kept,
            "keptFrom": kept_src,
            "discarded": dropped,
            "discardedFrom": dropped_src,
        }
        target["flags"].append(f"{field} disagreed: kept '{kept}' over '{dropped}'")
        person.overrides.append(entry)
        if registry:
            registry.overrides.append(entry)

    if deceased_at and not target["deceasedAt"]:
        target["deceasedAt"] = deceased_at
    if note and note not in target["notes"]:
        target["notes"].append(note)
    if source not in target["sources"]:
        target["sources"].append(source)


def person_to_json(p: Person) -> dict:
    """Serialise to the `Person` shape documented in lib/plan_schema.py."""
    return {
        "id": p.id,
        "firstName": p.fields.get("firstName", ""),
        "lastName": p.fields.get("lastName", ""),
        "fullName": p.fields.get("name", ""),
        "email": p.fields.get("email", ""),
        "emailIsPlaceholder": is_placeholder(p.fields.get("email", "")),
        "otherEmails": p.other_emails,
        "phone": p.fields.get("phone", ""),
        "address": p.fields.get("address", ""),
        "city": p.fields.get("city", ""),
        "postcode": p.fields.get("postcode", ""),
        "company": p.fields.get("company", ""),
        "dogs": [{
            "name": d["name"],
            "breed": d["breed"],
            "deceasedAt": d["deceasedAt"],
            "notes": d["notes"],
            "sources": d["sources"],
            "flags": d["flags"],
        } for d in p.dogs],
        "enrolments": p.enrolments,
        "oneToOneConsults": p.consults,
        "customFields": p.custom,
        "notes": "\n".join(p.notes),
        "accessCodes": p.access_codes,
        "afRefs": p.af_refs,
        "waitlist": p.waitlist,
        "isSubscriber": p.subscriber is not None,
        "subscriber": p.subscriber,
        "sources": p.sources,
        "provenance": p.provenance,
        "overrides": p.overrides,
        "flags": p.flags,
    }
