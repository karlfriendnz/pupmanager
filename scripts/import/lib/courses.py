"""
The class catalogue — every class anyone refers to, whether it exists or not.

WHY THIS EXISTS
---------------
Class history lives in two places that were never reconciled. The intake
spreadsheet has header rows ("STARTS Tuesday 4th March, 6pm 'The Dalmatians'")
that define an intake. The contacts export has one-line references typed later
("SP's January 2026 - The Welsh Corgi's"), sometimes for intakes the
spreadsheet never recorded, sometimes for classes run by a PREVIOUS trainer.

Three things follow, and this module is all three:

1. **Match references onto real classes, fuzzily but visibly.** Nicknames are
   typed from memory: quotes differ, plurals differ, "The" comes and goes. So
   matching goes through `resolve_nickname`, and every non-exact match is
   recorded on the class as a flag naming HOW it matched. A fuzzy join nobody
   can see is a fuzzy join nobody can veto.

2. **Invent the ones that are missing.** A reference to a class we have no
   record of is still a fact about that person's history. Dropping it loses
   real history; guessing it into a similar class corrupts real history. So we
   mint a class with `origin: "invented"`, named from whatever the note gave
   us, and let the client decide.

3. **Say when an invention is probably a duplicate.** If a spreadsheet class
   had its header row truncated (no nickname parsed) but its raw header text
   contains the nickname we just invented from, that is very likely the same
   intake. We keep them separate — merging is the client's call — but we say
   so in needsReview.

Ambiguity is never resolved silently: a nickname matching two classes picks
the first and files a review note naming both.
"""

from __future__ import annotations

from collections import defaultdict

from .text import clean, norm_nickname, resolve_nickname


class CourseCatalogue:
    """Classes from the source of record, plus classes invented from references."""

    def __init__(self, courses, *, level_for_code: dict[str, str] | None = None,
                 id_prefix: str = "S", invented_prefix: str = "N",
                 nickname_junk: set[str] | None = None,
                 default_code: str = "") -> None:
        self.courses: dict[str, dict] = {}
        self.by_nick: dict[str, list[dict]] = defaultdict(list)
        self.needs_review: list[dict] = []
        self.level_for_code = dict(level_for_code or {})
        self.code_for_level = {v: k for k, v in self.level_for_code.items()}
        self.nickname_junk = set(nickname_junk or ())
        self.default_code = default_code
        self._id_prefix = id_prefix
        self._invented_prefix = invented_prefix

        for c in courses:
            key = norm_nickname(c.get("nickname"))
            cid = f"{id_prefix}{c['externalId']}"
            rec = {
                "id": cid,
                "origin": "spreadsheet",
                "externalId": c["externalId"],
                "level": c.get("level"),
                "code": self.code_for_level.get(c.get("level") or "", ""),
                "name": self._name_for(c),
                "nickname": c.get("nickname"),
                "nicknameKey": key,
                "day": c.get("day"),
                "date": c.get("date"),
                "month": None,
                "year": None,
                "time": c.get("time"),
                "location": c.get("location"),
                "priorProvider": False,
                "headerRaw": c.get("headerRaw"),
                "sourceRefs": [],
                "flags": [],
            }
            self.courses[cid] = rec
            if key:
                self.by_nick[key].append(rec)

        self.nick_keys = list(self.by_nick)
        self._invented: dict[tuple, dict] = {}
        self._invented_seq = 0

    @staticmethod
    def _name_for(c: dict) -> str:
        """A class name a human can recognise in a dropdown a year from now."""
        nick = clean(c.get("nickname"))
        when = " ".join(x for x in [clean(c.get("day")), clean(c.get("date"))] if x)
        level = c.get("level")
        if nick:
            return f"{level} — {nick}"
        return f"{level} — {when}" if when else f"{level} — Class {c['externalId']}"

    # -- matching ----------------------------------------------------------

    def match_ref(self, ref: dict, who: str) -> dict | None:
        """Resolve a free-text class reference onto a known class, or None."""
        key = ref.get("nicknameKey")
        if not key:
            return None
        matched, how = resolve_nickname(key, self.nick_keys)
        if not matched:
            return None

        cands = self.by_nick[matched]
        want = self.level_for_code.get(ref.get("code") or "")
        if len(cands) > 1:
            same = [c for c in cands if c["level"] == want]
            if len(same) == 1:
                return same[0]
            self.needs_review.append({
                "kind": "Ambiguous course nickname",
                "who": who,
                "detail": (f"'{ref.get('raw')}' matches {len(cands)} spreadsheet "
                           f"classes ({', '.join(c['name'] for c in cands)}). "
                           f"Used the first."),
            })
            return cands[0]

        course = cands[0]
        if want and course["level"] != want:
            self.needs_review.append({
                "kind": "Class level disagrees",
                "who": who,
                "detail": (f"Contacts says {ref.get('code')} ({want}) but the "
                           f"spreadsheet class '{course['name']}' is "
                           f"{course['level']}. Kept the spreadsheet class."),
            })
            course["flags"].append(f"level mismatch vs contacts ({ref.get('code')})")
        if how != "exact":
            course["flags"].append(f"matched by {how}: '{ref.get('nickname')}'")
        return course

    # -- invention ---------------------------------------------------------

    def _usable_nickname(self, ref: dict) -> str:
        """A nickname worth naming a class after — junk parses excluded."""
        key = clean(ref.get("nicknameKey"))
        raw = clean(ref.get("nickname"))
        if not key or not raw:
            return ""
        junk = self.nickname_junk
        if key in junk:
            return ""
        toks = [t for t in key.split() if t not in junk]
        return raw if toks else ""

    def invent_for(self, ref: dict) -> dict:
        """
        Mint a class for a reference nothing matched.

        Keyed on (code, month, year, nickname, priorProvider) so twenty people
        referring to the same missing intake produce ONE new class, not twenty.
        """
        nick = self._usable_nickname(ref)
        code = clean(ref.get("code")) or self.default_code
        level = self.level_for_code.get(code, code)
        month, year = clean(ref.get("month")), clean(ref.get("year"))
        prior = bool(ref.get("priorProvider"))
        key = (code, month, year, norm_nickname(nick), prior)
        if key in self._invented:
            return self._invented[key]

        self._invented_seq += 1
        when = " ".join(x for x in [month, year] if x) or "date unknown"
        name = f"{level} — {when}"
        if nick:
            name = (f"{level} — {nick} ({when})" if when != "date unknown"
                    else f"{level} — {nick}")
        if prior:
            name += " (previous trainer)"

        cid = f"{self._invented_prefix}{self._invented_seq:03d}"
        rec = {
            "id": cid,
            "origin": "invented",
            "externalId": None,
            "level": level,
            "code": code,
            "name": name,
            "nickname": nick or None,
            "nicknameKey": norm_nickname(nick) if nick else "",
            "day": None, "date": None,
            "month": month or None, "year": year or None,
            "time": None, "location": None,
            "priorProvider": prior,
            "headerRaw": None,
            "sourceRefs": [],
            "flags": (["no nickname in the contacts note — named from its date"]
                      if not nick else []),
        }

        # Is this plausibly a known class whose header row was truncated?
        if nick:
            nk = norm_nickname(nick)
            for c in self.courses.values():
                if c["origin"] != "spreadsheet" or c["nicknameKey"]:
                    continue
                header = norm_nickname(c.get("headerRaw") or "")
                if nk and nk in header:
                    rec["probableSpreadsheetMatch"] = c["id"]
                    rec["flags"].append(
                        f"probably the same class as spreadsheet '{c['name']}' "
                        f"(its header row was cut off) — check before importing")
                    self.needs_review.append({
                        "kind": "Invented class may already exist",
                        "who": "",
                        "detail": (f"New class '{name}' looks like spreadsheet class "
                                   f"{c['id']} ('{c['headerRaw']}'). Kept separate "
                                   f"as instructed — merge if she agrees."),
                    })
                    break

        self._invented[key] = rec
        self.courses[cid] = rec
        return rec

    # -- enrolment bookkeeping --------------------------------------------

    def count_enrolments(self, people) -> None:
        counts: dict[str, int] = {}
        for p in people:
            for e in p.enrolments:
                counts[e["courseId"]] = counts.get(e["courseId"], 0) + 1
        for cid, c in self.courses.items():
            c["enrolmentCount"] = counts.get(cid, 0)


def add_enrolment(person, course: dict, source: str, *, raw: str = "",
                  dog: str = "", did_not_attend: bool = False,
                  prior_provider: bool = False, source_row: str = "") -> None:
    """
    Record that a person took a class — idempotently.

    A second sighting of the same (person, class) does not create a second
    enrolment; it adds its source, its raw text and its dog to the one that
    exists. Booleans are OR-ed, because "one file says they did not attend" is
    information and the other file's silence is not a contradiction.
    """
    for e in person.enrolments:
        if e["courseId"] == course["id"]:
            if source not in e["sources"]:
                e["sources"].append(source)
            if raw and raw not in e["rawRefs"]:
                e["rawRefs"].append(raw)
            if dog and not e["dog"]:
                e["dog"] = dog
            e["didNotAttend"] = e["didNotAttend"] or did_not_attend
            e["priorProvider"] = e["priorProvider"] or prior_provider
            if source_row and source_row not in e["sourceRows"]:
                e["sourceRows"].append(source_row)
            return

    person.enrolments.append({
        "courseId": course["id"],
        "courseName": course["name"],
        "courseOrigin": course["origin"],
        "level": course["level"],
        "dog": clean(dog),
        "didNotAttend": did_not_attend,
        "priorProvider": prior_provider,
        "sources": [source],
        "rawRefs": [raw] if raw else [],
        "sourceRows": [source_row] if source_row else [],
    })
    if source_row and source_row not in course["sourceRefs"]:
        course["sourceRefs"].append(source_row)


def add_consult(person, ref: dict, source: str,
                service_names: dict[str, str] | None = None,
                fallback: str = "1:1 / in-home service") -> None:
    """A 1:1 / in-home service reference. NOT a class enrolment — see README."""
    service_names = service_names or {}
    code = clean(ref.get("code")).upper()
    rec = {
        "code": code,
        "service": service_names.get(code, fallback),
        "month": ref.get("month"),
        "year": ref.get("year"),
        "raw": ref.get("raw"),
        "source": source,
    }
    if rec not in person.consults:
        person.consults.append(rec)
