"""
Tidy-up and serialisation — the last pass, once every file has been read.

WHY THIS IS SEPARATE FROM THE MERGE
-----------------------------------
Some things about a person cannot be judged while the files are still being
read. "This person has no email address in any source" is the obvious one: a
waitlist lead with no address very often turns out to be on the mailing list
under a real one, and a flag raised the moment a placeholder was minted
outlives the fact it described.

The same goes for "takes classes but we have no dog for them", for the class
enrolment counts, and for anything that compares a person against the FINAL
state of their own record rather than the state mid-merge.

So `finalise` runs once, at the end, over everybody. It is the only place
allowed to draw conclusions, and `serialise` then writes the plan out in the
shape `lib/plan_schema.py` documents.
"""

from __future__ import annotations

from collections import Counter

from .config import ClientConfig
from .courses import CourseCatalogue
from .dedup import is_placeholder
from .dogs import DogNameJudge
from .people import Registry, person_to_json
from .text import clean, split_name


def finalise(reg: Registry, catalogue: CourseCatalogue, stats: Counter,
              cfg: ClientConfig) -> None:
    for p in reg.people:
        # A record with neither a name nor a breed is not a dog. Whatever was
        # written in its cells goes back onto the person so nothing is lost.
        kept = []
        for d in p.dogs:
            if d["name"] or d["breed"]:
                kept.append(d)
                continue
            for line in d["notes"]:
                p.add_note(line, d["sources"][0] if d["sources"] else "import")
        p.dogs = kept

        if p.enrolments and not p.dogs:
            stats["peopleInAClassWithNoDog"] += 1
            p.add_flag("takes classes but we have no dog for them")
        if is_placeholder(p.fields.get("email", "")):
            p.add_flag("no email in any source — placeholder address generated")
        if not clean(p.fields.get("name", "")):
            p.add_flag("no name in any source")
            reg.review("Person with no name", p.fields.get("email", ""),
                       f"{p.id} came through with an email address "
                       f"({p.fields.get('email')}) but no name at all.")
        if not p.fields.get("firstName") and p.fields.get("name"):
            f, l = split_name(p.fields["name"])
            p.fields.setdefault("firstName", f)
            if l:
                p.fields.setdefault("lastName", l)

        # Precedence can leave a first-name-only person when a later file had
        # the full name. The rule stands; the loss is announced.
        top = max(cfg.priorities, key=cfg.priorities.get) if cfg.priorities else ""
        winners = {s for s, v in cfg.priorities.items()
                   if v >= cfg.priorities.get(top, 0) - 5}
        if (p.provenance.get("name") in winners
                and len(clean(p.fields.get("name", "")).split()) == 1
                and any(o["field"] == "name" and len(o["discarded"].split()) > 1
                        for o in p.overrides)):
            src = p.provenance.get("name", "the winning file")
            p.add_flag(f"{src} had only a first name; a fuller name was discarded")
            reg.review(f"{src.capitalize()} name may be incomplete",
                       p.fields.get("name", ""),
                       f"The {src} holds only a first name and a fuller name "
                       f"from another file was set aside "
                       f"({src} wins by precedence).")

        prof = cfg.custom_field("professional")
        biz = cfg.custom_field("business")
        if prof and p.custom.get(prof) == "Yes" and biz and not p.custom.get(biz):
            p.add_flag("professional with no business name")

        if p.access_codes:
            stats["peopleWithAccessCodes"] += 1
        if cfg.custom_field("credit") and p.custom.get(cfg.custom_field("credit")):
            stats["peopleWithCredit"] += 1
        if cfg.custom_field("volunteer") and p.custom.get(cfg.custom_field("volunteer")) == "Yes":
            stats["volunteers"] += 1
        if p.consults:
            stats["peopleWithConsults"] += 1
        if not p.enrolments and not p.consults and not p.waitlist:
            stats["peopleWithNoHistory"] += 1
        if p.subscriber and not p.enrolments and not p.consults:
            stats["subscribersWhoNeverTookAClass"] += 1

    catalogue.count_enrolments(reg.people)
    reg.needs_review.extend(catalogue.needs_review)

    stats["people"] = len(reg.people)
    stats["courses"] = len(catalogue.courses)
    stats["coursesFromSource"] = sum(1 for c in catalogue.courses.values()
                                     if c["origin"] == "spreadsheet")
    stats["coursesInvented"] = sum(1 for c in catalogue.courses.values()
                                   if c["origin"] == "invented")
    stats["enrolments"] = sum(len(p.enrolments) for p in reg.people)
    stats["dogs"] = sum(len(p.dogs) for p in reg.people)
    stats["fieldOverrides"] = len(reg.overrides)


# ---------------------------------------------------------------------------
# Serialisation
# ---------------------------------------------------------------------------

def serialise(cfg: ClientConfig, reg: Registry, catalogue: CourseCatalogue,
               judge: DogNameJudge, stats: Counter,
               subscribers: list[dict], exclusive_links: list[dict]) -> dict:
    people = [person_to_json(p) for p in reg.people]
    by_id = {p.id: p for p in reg.people}

    # One row per SOURCE ROW, not per person: two mailing-list rows that turn
    # out to be one human are still two subscriptions, and the client's list
    # size has to reconcile with what they see in their mail tool.
    professionals = []
    for link in exclusive_links:
        p = by_id.get(link["personId"])
        professionals.append({
            "personId": link["personId"],
            "name": link["name"],
            "nameInPlan": p.fields.get("name", "") if p else "",
            "business": (p.custom.get(cfg.custom_field("business"), "")
                         if p else ""),
            "email": p.fields.get("email", "") if p else "",
            "phone": p.fields.get("phone", "") if p else "",
            "role": link["role"],
            "matchedBy": link["matchedBy"],
            "classes": len(p.enrolments) if p else 0,
            "flags": p.flags if p else [],
        })

    stats["subscribers"] = len(subscribers)
    stats["professionals"] = len(professionals)
    stats["junkDogNames"] = len(judge.overrides)

    return {
        "meta": {
            "generatedBy": "scripts/import/build_plan.py",
            "client": cfg.slug,
            "clientName": cfg.name,
            # The load half derives its own placeholder addresses from this and
            # recognises a re-run by them. It must be the namespace we actually
            # hashed with, not the client slug — otherwise a second run mints
            # different addresses and every email-less person arrives twice.
            "emailNamespace": cfg.placeholder_namespace,
            "sources": {f.name: str(f.path) for f in cfg.files},
            # Declared order, so a review workbook's columns stay put between
            # runs even when the data happens to mention them in a different
            # order.
            "customFields": [v for v in cfg.custom_fields.values() if v],
            "csv": {"companyTo": cfg.csv_company_to,
                    "oncePerPerson": list(cfg.csv_once_per_person)},
            "rules": {
                "processingOrder": [f.name for f in cfg.files],
                "precedence": [k for k, _ in sorted(cfg.priorities.items(),
                                                    key=lambda kv: -kv[1])],
                "placeholderEmailPattern":
                    "noemail-<16hex>@no-email.pupmanager.app",
            },
            "counts": dict(sorted(stats.items())),
        },
        "people": people,
        "courses": list(catalogue.courses.values()),
        "subscribers": subscribers,
        "professionals": professionals,
        "junkDogNameOverrides": judge.overrides,
        "fieldOverrides": reg.overrides,
        "needsReview": reg.needs_review,
    }
