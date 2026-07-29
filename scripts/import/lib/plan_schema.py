"""
The canonical import plan — its shape, written down, and a validator.

WHY THIS EXISTS
---------------
The plan is the contract between the two halves of an onboarding. The EXTRACT
half (this toolkit) reads a client's files and writes `plan.json`. The LOAD
half (a separate script, with database access) reads `plan.json` and creates
records. Nothing else crosses the line.

That only works if the shape is written down somewhere other than in the head
of whoever wrote the extractor. Before this module, the shape existed as
"whatever build-plan.py happened to emit", which meant the importer had to be
read alongside the exporter to know whether `dogs[].deceasedAt` was a date, a
boolean or the string "unknown". (It is a date OR the literal "unknown" — the
data really does contain "we know the dog died, we cannot read when".)

WHAT `validate` IS FOR
----------------------
It is not a type-checker. It answers a narrower and more useful question:
*would a human reviewing this plan be misled, or would the loader crash?*

So it reports, with a path you can paste into `jq`:

  * structural breakage (a missing key, a list where an object belongs)
  * referential breakage (an enrolment pointing at a class that is not in the
    plan; a subscriber pointing at a person id that does not exist)
  * silent-loss risks (a person with no name AND no email — unfindable in the
    review workbook, so it must be in needsReview instead)
  * rule violations the merge engine is supposed to guarantee (a placeholder
    email that does not look like one; two people sharing a real email)

Warnings are returned separately from errors because a lot of what looks
wrong in client data is simply true. A person with no dog is normal. A class
with no enrolments is normal. Neither should stop an import; both should be
visible.

THE SHAPE
---------
    {
      "meta":     {generatedBy, client, generatedAt?, sources{}, rules{}, counts{}},
      "people":   [Person],
      "courses":  [Course],
      "subscribers": [SubscriberLink],
      "professionals": [ProfessionalLink],
      "junkDogNameOverrides": [{person, where, value, reason}],
      "fieldOverrides": [{personId, person, field, kept, keptFrom,
                          discarded, discardedFrom}],
      "needsReview": [{kind, who, detail}]
    }

    Person = {
      id                 "P0001", stable within one run
      firstName lastName fullName
      email              always present; may be a placeholder
      emailIsPlaceholder True when the address was invented by us
      otherEmails        [str] real addresses that lost a precedence fight
      phone address city postcode company
      dogs               [Dog]
      enrolments         [Enrolment]
      oneToOneConsults   [Consult]
      customFields       {label: value}
      notes              one string, "[source] line" per line
      accessCodes        [str]   door/lockbox codes, never mixed into notes
      afRefs             [{number, raw, bare}]
      waitlist           [{category, sourceRow, breedAge, dogRaw, notes}]
      isSubscriber       bool
      subscriber         {...} | None
      sources            [str] which files this person appeared in
      provenance         {field: source} which file won each field
      overrides          [FieldOverride] what was set aside, and why
      flags              [str] plain-English things to look at
    }

    Dog = {name, breed, deceasedAt (ISO date | "unknown" | None),
           notes[], sources[], flags[]}

    Enrolment = {courseId, courseName, courseOrigin, level, dog,
                 didNotAttend, priorProvider, sources[], rawRefs[],
                 sourceRows[]}

    Course = {id, origin ("spreadsheet"|"invented"), externalId, level, code,
              name, nickname, nicknameKey, day, date, month, year, time,
              location, priorProvider, headerRaw, sourceRefs[], flags[],
              enrolmentCount}
"""

from __future__ import annotations

import re
from typing import Any

PLACEHOLDER_SUFFIX = "@no-email.pupmanager.app"
PLACEHOLDER_RE = re.compile(r"^noemail-[0-9a-f]{16}@no-email\.pupmanager\.app$")

TOP_LEVEL_KEYS = ("meta", "people", "courses", "subscribers", "professionals",
                  "junkDogNameOverrides", "fieldOverrides", "needsReview")

PERSON_KEYS = (
    "id", "firstName", "lastName", "fullName", "email", "emailIsPlaceholder",
    "otherEmails", "phone", "address", "city", "postcode", "company", "dogs",
    "enrolments", "oneToOneConsults", "customFields", "notes", "accessCodes",
    "afRefs", "waitlist", "isSubscriber", "subscriber", "sources",
    "provenance", "overrides", "flags",
)

DOG_KEYS = ("name", "breed", "deceasedAt", "notes", "sources", "flags")

ENROLMENT_KEYS = ("courseId", "courseName", "courseOrigin", "level", "dog",
                  "didNotAttend", "priorProvider", "sources", "rawRefs",
                  "sourceRows")

COURSE_KEYS = ("id", "origin", "level", "code", "name", "nickname",
               "nicknameKey", "day", "date", "month", "year", "time",
               "location", "priorProvider", "headerRaw", "sourceRefs", "flags")

CONSULT_KEYS = ("code", "service", "month", "year", "raw", "source")

ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


# ---------------------------------------------------------------------------
# Empty templates — a source module builds its fragments from these so a
# missing key is impossible rather than merely unlikely.
# ---------------------------------------------------------------------------

def empty_person_fragment(source: str) -> dict:
    """
    The unit every source module emits: one person as ONE file saw them.

    A fragment is not a Person. It is one file's opinion, which the merge
    engine then reconciles with the other files' opinions. Keeping the two
    types distinct is what lets a new source shape be written without knowing
    anything about precedence.
    """
    return {
        "source": source,
        "sourceKey": "",        # seeds a deterministic placeholder email
        "sourceRow": "",
        "name": "", "firstName": "", "lastName": "",
        "email": "", "otherEmails": [],
        "phone": "", "address": "", "city": "", "postcode": "", "company": "",
        "dogs": [],             # {name, breed, note, deceased, deceasedAt,
                                #  judge, where, requireName}
        "courseRefs": [],       # see empty_course_ref
        "consults": [],         # {code, month, year, raw}
        "waitlist": [],         # {category, sourceRow, breedAge, dogRaw, notes}
        "notes": [],            # plain lines; the engine tags them by source
        "addressHints": [],     # address-ish lines found in free text
        "unclassified": [],     # lines no rule claimed — kept, always
        "freeText": [],
        "accessCodes": [], "afRefs": [], "credits": [], "roles": [],
        "customFields": {},
        "subscriber": None,
        "flags": [], "review": [],
        "extra": {},            # source-private detail, not imported
        # Match policy — how this fragment is allowed to join an existing
        # person. Sources set it; the engine obeys it.
        "allowNameMatch": True,
        "neverMerge": False,        # no email: never joins anyone
        "claimsExclusive": "",      # e.g. "professional": one per person
        "requireCompatibleName": False,  # an email match also needs a name match
    }


def empty_course_ref() -> dict:
    return {
        "externalId": None,   # set when the source knows the exact class
        "code": "", "level": "",
        "month": None, "year": None,
        "nickname": None, "nicknameKey": None,
        "dog": "", "raw": "", "comment": None,
        "priorProvider": False, "didNotAttend": False,
        "sourceRow": "",
    }


def empty_fragment(source: str) -> dict:
    """
    One file's (or one sheet's) opinion.

    selfDeduped        this source has already resolved its own duplicates, so
                       two of its records are two people whatever they are
                       called — the engine must not merge them into each other.
    scanNotesForRoles  its notes column marks helpers in prose ("B:Volunteer").
    announceNameMatch  whether a name-only match against an existing person is
                       worth a review note. True for a FOREIGN file (two files
                       agreeing on a name but not an email is worth a look);
                       False for a second sheet of the SAME document, where a
                       name match is the expected outcome, not a surprise.
    messages           per-shape wording for the review notes the engine
                       writes, so the workbook reads like it was written about
                       THIS file rather than by a generic engine.
    """
    return {"source": source, "courses": [], "people": [], "needsReview": [],
            "selfDeduped": False, "scanNotesForRoles": False,
            "announceNameMatch": True, "messages": {}}


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

class Problem:
    __slots__ = ("level", "path", "message")

    def __init__(self, level: str, path: str, message: str) -> None:
        self.level, self.path, self.message = level, path, message

    def __str__(self) -> str:
        return f"{self.level.upper():7} {self.path:28} {self.message}"

    def as_dict(self) -> dict:
        return {"level": self.level, "path": self.path, "message": self.message}


def validate(plan: Any) -> list[Problem]:
    """
    Check a plan and return every problem found, worst first.

    Deliberately exhaustive rather than fail-fast: an onboarding is a batch
    job run by one person on a laptop, and "here are all 40 things wrong" is
    worth far more than "here is the first thing wrong", forty times.
    """
    out: list[Problem] = []
    err = lambda p, m: out.append(Problem("error", p, m))
    warn = lambda p, m: out.append(Problem("warning", p, m))

    if not isinstance(plan, dict):
        return [Problem("error", "$", "the plan is not an object")]

    for key in TOP_LEVEL_KEYS:
        if key not in plan:
            err("$", f"missing top-level key {key!r}")
    if out:
        return out

    if not isinstance(plan["meta"], dict):
        err("$.meta", "must be an object")
    else:
        for key in ("generatedBy", "sources", "rules", "counts"):
            if key not in plan["meta"]:
                warn("$.meta", f"missing {key!r}")

    for key in TOP_LEVEL_KEYS[1:]:
        if not isinstance(plan[key], list):
            err(f"$.{key}", "must be a list")
    if any(p.level == "error" for p in out):
        return out

    # ---- courses ---------------------------------------------------------
    course_ids: set[str] = set()
    for i, c in enumerate(plan["courses"]):
        path = f"$.courses[{i}]"
        if not isinstance(c, dict):
            err(path, "must be an object")
            continue
        for key in COURSE_KEYS:
            if key not in c:
                err(path, f"missing {key!r}")
        cid = c.get("id")
        if not cid:
            err(path, "has no id")
        elif cid in course_ids:
            err(path, f"duplicate course id {cid!r}")
        else:
            course_ids.add(cid)
        if c.get("origin") not in ("spreadsheet", "invented"):
            err(path, f"origin must be spreadsheet|invented, got {c.get('origin')!r}")
        if not str(c.get("name") or "").strip():
            err(path, "has no name — it would be unidentifiable in review")

    # ---- people ----------------------------------------------------------
    person_ids: set[str] = set()
    real_emails: dict[str, str] = {}
    for i, p in enumerate(plan["people"]):
        path = f"$.people[{i}]"
        if not isinstance(p, dict):
            err(path, "must be an object")
            continue
        for key in PERSON_KEYS:
            if key not in p:
                err(path, f"missing {key!r}")

        pid = p.get("id")
        if not pid:
            err(path, "has no id")
        elif pid in person_ids:
            err(path, f"duplicate person id {pid!r}")
        else:
            person_ids.add(pid)
        path = f"$.people[{i}]({pid})"

        email = (p.get("email") or "").strip()
        is_ph = bool(p.get("emailIsPlaceholder"))
        if not email:
            err(path, "has no email at all — every person needs one, real or placeholder")
        elif is_ph and not PLACEHOLDER_RE.match(email):
            err(path, f"flagged as a placeholder but {email!r} is not one")
        elif not is_ph and email.endswith(PLACEHOLDER_SUFFIX):
            err(path, "is a placeholder address but is not flagged as one")
        elif not is_ph:
            if "@" not in email:
                err(path, f"email {email!r} is not an address")
            prev = real_emails.get(email)
            if prev and prev != pid:
                warn(path, f"shares the real email {email} with {prev} — "
                           "check they are not the same person")
            real_emails.setdefault(email, pid)

        if not (p.get("fullName") or "").strip():
            # Unfindable in the workbook, so it MUST be called out explicitly.
            if not _mentioned_in_review(plan, email):
                err(path, "has no name and is not listed in needsReview")

        if not isinstance(p.get("customFields"), dict):
            err(path, "customFields must be an object")
        if not isinstance(p.get("notes"), str):
            err(path, "notes must be one string (join the lines)")
        if p.get("isSubscriber") and p.get("subscriber") is None:
            err(path, "isSubscriber is true but subscriber detail is missing")
        if p.get("subscriber") is not None and not p.get("isSubscriber"):
            err(path, "has subscriber detail but isSubscriber is false")

        for j, d in enumerate(p.get("dogs") or []):
            dpath = f"{path}.dogs[{j}]"
            if not isinstance(d, dict):
                err(dpath, "must be an object")
                continue
            for key in DOG_KEYS:
                if key not in d:
                    err(dpath, f"missing {key!r}")
            if not (d.get("name") or "").strip() and not (d.get("breed") or "").strip():
                err(dpath, "has neither a name nor a breed — it is not a dog")
            da = d.get("deceasedAt")
            if da not in (None, "unknown") and not ISO_DATE_RE.match(str(da)):
                err(dpath, f"deceasedAt must be an ISO date, 'unknown' or null, got {da!r}")

        for j, e in enumerate(p.get("enrolments") or []):
            epath = f"{path}.enrolments[{j}]"
            if not isinstance(e, dict):
                err(epath, "must be an object")
                continue
            for key in ENROLMENT_KEYS:
                if key not in e:
                    err(epath, f"missing {key!r}")
            if e.get("courseId") not in course_ids:
                err(epath, f"points at class {e.get('courseId')!r} which is not in the plan")
            if not e.get("sources"):
                warn(epath, "has no source — we cannot say where it came from")

        seen_courses = [e.get("courseId") for e in (p.get("enrolments") or [])]
        if len(seen_courses) != len(set(seen_courses)):
            err(path, "is enrolled in the same class twice")

        for j, c in enumerate(p.get("oneToOneConsults") or []):
            cpath = f"{path}.oneToOneConsults[{j}]"
            for key in CONSULT_KEYS:
                if key not in c:
                    err(cpath, f"missing {key!r}")

        for j, o in enumerate(p.get("overrides") or []):
            if not isinstance(o, dict) or "field" not in o or "kept" not in o:
                err(f"{path}.overrides[{j}]", "must record at least field and kept")

    # ---- cross-references ------------------------------------------------
    for i, s in enumerate(plan["subscribers"]):
        if s.get("personId") and s["personId"] not in person_ids:
            err(f"$.subscribers[{i}]", f"points at unknown person {s['personId']!r}")
    for i, pr in enumerate(plan["professionals"]):
        if pr.get("personId") and pr["personId"] not in person_ids:
            err(f"$.professionals[{i}]", f"points at unknown person {pr['personId']!r}")
    for i, o in enumerate(plan["fieldOverrides"]):
        if o.get("personId") and o["personId"] not in person_ids:
            err(f"$.fieldOverrides[{i}]", f"points at unknown person {o['personId']!r}")
    for i, n in enumerate(plan["needsReview"]):
        for key in ("kind", "detail"):
            if key not in n:
                err(f"$.needsReview[{i}]", f"missing {key!r}")

    # ---- counts ----------------------------------------------------------
    counts = (plan["meta"] or {}).get("counts") or {}
    for key, actual in (("people", len(plan["people"])),
                        ("courses", len(plan["courses"]))):
        if key in counts and counts[key] != actual:
            warn("$.meta.counts", f"{key} says {counts[key]} but the plan holds {actual}")

    out.sort(key=lambda p: (p.level != "error", p.path))
    return out


def _mentioned_in_review(plan: dict, needle: str) -> bool:
    if not needle:
        return False
    return any(needle in (n.get("who") or "") or needle in (n.get("detail") or "")
               for n in plan.get("needsReview") or [])


def summarise(plan: dict) -> dict:
    """The headline numbers, recomputed from the plan rather than trusted."""
    people = plan.get("people") or []
    return {
        "people": len(people),
        "dogs": sum(len(p.get("dogs") or []) for p in people),
        "courses": len(plan.get("courses") or []),
        "enrolments": sum(len(p.get("enrolments") or []) for p in people),
        "consults": sum(len(p.get("oneToOneConsults") or []) for p in people),
        "subscribers": len(plan.get("subscribers") or []),
        "professionals": len(plan.get("professionals") or []),
        "placeholderEmails": sum(1 for p in people if p.get("emailIsPlaceholder")),
        "needsReview": len(plan.get("needsReview") or []),
        "fieldOverrides": len(plan.get("fieldOverrides") or []),
    }
