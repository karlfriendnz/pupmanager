"""
The merge engine — many files' opinions in, one reviewable plan out.

WHY THIS EXISTS
---------------
Reading a file is easy. Deciding that the Jo Bloggs in the spreadsheet, the
J Bloggs in the contacts export and the jo.bloggs@ on the mailing list are one
person — and that her phone number should come from the spreadsheet but her
dog's name from the contacts card — is the entire job. Doing it consistently,
and being able to SHOW why, is what makes an import reviewable instead of
merely finished.

This module owns every decision. Source modules describe files; this decides
identity, precedence, and what gets written down about both.

THE ORDER OF OPERATIONS
-----------------------
Files are processed in the order the client config lists them. The first is
the SPINE: usually the business's own operating spreadsheet, the file with the
history in it. Everything after matches into what the spine created.

That is separate from PRECEDENCE, which decides who wins a field-level
disagreement. The contacts export is processed third but must never overwrite
a phone number the spreadsheet already had. Two orderings, two config keys.

WHAT NEVER HAPPENS
------------------
* Nothing is dropped. Unclassifiable note lines, rejected dog names and
  unreadable spreadsheet rows all survive — into `notes`, into
  `junkDogNameOverrides`, into `needsReview`.
* No silent overwrite. Every discarded value is recorded with both sources.
* No merge on no evidence. A record with no email address never joins another
  person; it gets an invented address and, if a same-named person exists, a
  review note saying so.
"""

from __future__ import annotations

import re
from collections import Counter

from .config import ClientConfig
from .courses import CourseCatalogue, add_consult, add_enrolment
from .dedup import breed_vocabulary, is_placeholder, placeholder_email
from .dogs import DogNameJudge
from .assemble import finalise, serialise
from .people import Person, Registry, merge_dog
from .text import (clean, names_compatible, norm_email, norm_name, parse_dmy,
                   split_name, values_agree)

DEFAULT_MESSAGES = {
    "nameMatchKind": "Matched on name, not email",
    "nameMatchDetail": ("{label}: {name} <{email}> was merged into "
                        "'{personName}' ({personId}) whose email is "
                        "<{personEmail}> — same name, two addresses. Check."),
    "nameMatchNote": "",
    "twinKind": "Record with no email — possible duplicate",
    "twinDetail": ("This {label} record has no email address, so it was kept as "
                   "its own person ({personId}) with a placeholder address. "
                   "'{twinName}' ({twinId}, {twinEmail}) has the same name and "
                   "is probably the same person — merge them if you agree."),
    "exclusiveKind": "Two records claim the same exclusive role",
    "exclusiveDetail": ("{name} shares {email} with {personName}. Kept as two "
                        "separate people, both using that email address."),
    "incompatibleKind": "Name does not match the person on that email",
    "incompatibleDetail": ("{name} <{email}> matched '{personName}'. Kept as "
                           "separate people — check."),
}


class Context:
    """What a source module is allowed to know about the run around it."""

    def __init__(self, cfg: ClientConfig) -> None:
        self.config = cfg
        self.grammar = cfg.grammar()
        self.breed_aliases = cfg.breed_aliases
        self.breed_vocab: set[str] = set()
        self.suburb_vocab: set[str] = set()

    def custom_field(self, key: str) -> str:
        return self.config.custom_field(key)


def build(cfg: ClientConfig, sources_registry) -> dict:
    """Read every configured file and return the plan (a plain dict)."""
    ctx = Context(cfg)
    stats: Counter = Counter()

    # ---- pass 1: learn the client's own words ---------------------------
    # A contacts file cannot tell a breed from a note, or a suburb from a
    # nickname, until it has seen the words this client actually uses.
    #
    # NOTE the deliberate split from `cfg.breed_words` / `cfg.suburbs`. Those
    # are CLASSIFIER SEEDS: a generous list used to decide "this spreadsheet
    # CELL is the breed column". This vocabulary is OBSERVED VALUES: breeds
    # this client actually keeps. The notes parser must use the observed set,
    # because it uses "is this a breed we have really seen?" as its evidence
    # that a line is a dog and not a service note. Seeding it with the generous
    # list makes every plausible word confident, and "Daisy - Corgi (ADT PP)"
    # stops being read as an ADT booking.
    #
    # Both passes get IDENTICAL options. They must: a source that reads its
    # file differently in the two passes teaches the vocabulary from one
    # reading and then parses with another. (That exact bug hid three dogs:
    # the vocabulary pass ran without the breed-classifier seeds, so the
    # spreadsheet's breed column went unrecognised, so "Golden Retriever" on a
    # contact card was no longer a breed we had "seen".)
    options = {
        f.name: {**f.options, "label": f.label,
                 "breedWords": list(cfg.breed_words),
                 "suburbs": list(cfg.suburbs)}
        for f in cfg.files
    }

    raw_breeds: list[str] = []
    for f in cfg.files:
        mod = sources_registry.get(f.shape)
        if not f.path.exists():
            raise SystemExit(f"missing input file: {f.path}")
        vocab = mod.vocabulary(f.path, options[f.name]) or {}
        raw_breeds.extend(vocab.get("breeds") or [])
        ctx.suburb_vocab |= {norm_name(s) for s in (vocab.get("suburbs") or set())}
    ctx.suburb_vocab.discard("")
    ctx.breed_vocab = breed_vocabulary(raw_breeds, cfg.breed_aliases)

    # ---- pass 2: read every file ----------------------------------------
    fragments: list[dict] = []
    for f in cfg.files:
        mod = sources_registry.get(f.shape)
        fragments.extend(mod.extract(f.path, options[f.name], ctx))

    # ---- the judge sees every breed in every file ------------------------
    all_breeds = list(raw_breeds)
    for frag in fragments:
        for p in frag["people"]:
            for d in p.get("dogs") or []:
                if d.get("breed"):
                    all_breeds.append(d["breed"])
    judge = DogNameJudge(all_breeds, rules=cfg.junk, aliases=cfg.breed_aliases)

    catalogue = CourseCatalogue(
        [c for frag in fragments for c in frag["courses"]],
        level_for_code=cfg.course_codes,
        nickname_junk=ctx.grammar.nickname_junk,
        default_code=cfg.default_course_code or next(iter(cfg.course_codes), ""),
    )
    reg = Registry(cfg.priorities, cfg.phone)
    subscriber_links: list[dict] = []
    exclusive_links: list[dict] = []

    for frag in fragments:
        label = frag["source"]
        for entry in frag.get("needsReview") or []:
            reg.review(entry["kind"], entry.get("who", ""), entry["detail"])
        for pf in frag["people"]:
            person, how, email = _place(pf, frag, reg, cfg, stats, label)
            _apply(person, pf, frag, reg, cfg, ctx, judge, catalogue, stats,
                   label, email)
            if pf.get("subscriber") is not None:
                subscriber_links.append({
                    "email": pf["subscriber"].get("email", ""),
                    "name": clean(pf.get("name")),
                    "personId": person.id,
                    "linkedBy": how or "new",
                    "acceptsMarketing": pf["subscriber"].get("acceptsMarketing", ""),
                    "createdOn": pf["subscriber"].get("createdOn", ""),
                })
            if pf.get("claimsExclusive"):
                exclusive_links.append({
                    "personId": person.id,
                    "name": clean(pf.get("name")),
                    "role": pf["claimsExclusive"],
                    "matchedBy": how or "new",
                    "detail": pf.get("extra", {}).get("row", {}),
                })
        stats[f"{label}Rows"] = len(frag["people"])

    finalise(reg, catalogue, stats, cfg)
    return serialise(cfg, reg, catalogue, judge, stats,
                     subscriber_links, exclusive_links)


# ---------------------------------------------------------------------------
# Identity
# ---------------------------------------------------------------------------

def _place(pf: dict, frag: dict, reg: Registry, cfg: ClientConfig,
           stats: Counter, label: str) -> tuple[Person, str, str]:
    """
    Find the person this fragment belongs to, or create them.

    Returns (person, how it matched, the email to record). That third value
    matters: when a record has no address we mint a placeholder, and the
    person must actually CARRY it — an unsaved placeholder leaves a person
    with no address at all, which is the one thing every downstream system
    refuses to accept.
    """
    msgs = {**DEFAULT_MESSAGES, **(frag.get("messages") or {})}
    name = clean(pf.get("name"))
    email = norm_email(pf.get("email"))

    def mint(seed: str) -> str:
        stats["placeholderEmails"] += 1
        return placeholder_email(seed or f"{label}::{name}",
                                 cfg.placeholder_namespace)

    # A source that has already deduplicated itself is authoritative about its
    # own rows: two of its records are two people, whatever they are called.
    if frag.get("selfDeduped"):
        email = email or mint(pf.get("sourceKey", ""))
        return reg.new_person(email, name), "", email

    # No address at all: never merge (lib/dedup.py rule 3).
    if pf.get("neverMerge"):
        stats[f"{label}WithNoEmail"] += 1
        twin, _ = reg.find("", name)
        email = mint(pf.get("sourceKey", ""))
        p = reg.new_person(email, name)
        stats[f"{label}OnlyPeople"] += 1
        if twin is not None:
            p.add_flag(f"possible duplicate of {twin.id}")
            reg.review(msgs["twinKind"], name, msgs["twinDetail"].format(
                label=label, personId=p.id, twinName=twin.fields.get("name"),
                twinId=twin.id, twinEmail=twin.fields.get("email")))
        return p, "", email

    person, how = reg.find(email, name,
                           allow_name=pf.get("allowNameMatch", True))

    claim = pf.get("claimsExclusive") or ""
    if person is not None and claim and claim in person.exclusive:
        reg.review(msgs["exclusiveKind"], name, msgs["exclusiveDetail"].format(
            name=name, email=email,
            personName=person.fields.get("name", "another record")))
        person, how = None, ""

    if (person is not None and how == "email" and pf.get("requireCompatibleName")
            and not names_compatible(name, person.fields.get("name", ""))):
        reg.review(msgs["incompatibleKind"], name,
                   msgs["incompatibleDetail"].format(
                       name=name, email=email,
                       personName=person.fields.get("name")))
        person, how = None, ""

    if person is None:
        email = email or mint(pf.get("sourceKey", ""))
        person = reg.new_person(email, name)
        stats[f"{label}OnlyPeople"] += 1
    else:
        stats[f"{label}MatchedBy_{how}"] += 1
        if (how == "name" and frag.get("announceNameMatch", True) and email
                and person.fields.get("email")
                and not values_agree("email", person.fields["email"], email,
                                     cfg.phone)):
            if msgs["nameMatchNote"]:
                person.add_note(msgs["nameMatchNote"].format(email=email), label)
            reg.review(msgs["nameMatchKind"], name,
                       msgs["nameMatchDetail"].format(
                           label=label, name=name, email=email,
                           personName=person.fields.get("name"),
                           personId=person.id,
                           personEmail=person.fields.get("email")))
        reg.index(person, email, name)

    if claim:
        person.exclusive.add(claim)
    return person, how, email


# ---------------------------------------------------------------------------
# Application
# ---------------------------------------------------------------------------

CORE_FIELDS = ("name", "firstName", "lastName", "email", "phone", "city",
               "postcode", "company", "address")


def _apply(p: Person, pf: dict, frag: dict, reg: Registry, cfg: ClientConfig,
           ctx: Context, judge: DogNameJudge, catalogue: CourseCatalogue,
           stats: Counter, label: str, email: str = "") -> None:
    p.add_source(label)
    for field in CORE_FIELDS:
        value = email if field == "email" else pf.get(field)
        p.set_field(field, value, label, reg)
    for e in pf.get("otherEmails") or []:
        p.add_other_email(e)
    # NB the "no email in any source" flag is deliberately NOT set here. It
    # can only be judged once every file has been read: a waitlist lead with
    # no address often turns out to be on the mailing list under a real one,
    # and a flag set mid-run would outlive the fact it described. _finalise
    # sets it against the final state.

    for f in pf.get("flags") or []:
        p.add_flag(f)
    for r in pf.get("review") or []:
        reg.review(r["kind"], r.get("who", clean(pf.get("name"))), r["detail"])

    for entry in pf.get("waitlist") or []:
        _apply_waitlist(p, entry, judge, label, reg, cfg)

    for line in pf.get("notes") or []:
        p.add_note(line, label)
        if frag.get("scanNotesForRoles") and _role_re(cfg).search(line or ""):
            _set_custom(p, cfg, "volunteer", "Yes")
            stats[f"volunteersFrom_{label}"] += 1

    # ---- dogs -----------------------------------------------------------
    for d in pf.get("dogs") or []:
        name = clean(d.get("name"))
        if d.get("judge"):
            name = judge.usable(d.get("name"), owner=clean(pf.get("name")),
                                person=p, where=d.get("where", label),
                                source=label)
            if d.get("requireName") and not name:
                continue
        merge_dog(p, name=name, breed=clean(d.get("breed")), source=label,
                  registry=reg, aliases=cfg.breed_aliases,
                  deceased_at=d.get("deceasedAt"), note=clean(d.get("note")))
        if d.get("deceased"):
            stats["deceasedDogs"] += 1
            reg.review("Dog has died", clean(pf.get("name")),
                       f"{d.get('name') or 'a dog'} is marked "
                       f"'{d.get('note') or 'PTS'}' — imported as died on "
                       f"{parse_dmy(d.get('note')) or 'a date we could not read'}. "
                       f"The owner is imported as normal.")

    # ---- classes --------------------------------------------------------
    for ref in pf.get("courseRefs") or []:
        course = _resolve_course(ref, catalogue, clean(pf.get("name")), stats,
                                 label)
        if course is None:
            continue
        dog = clean(ref.get("dog"))
        if ref.get("judgeDog"):
            dog = judge.usable(ref.get("dog"), owner=clean(pf.get("name")),
                               person=p, where=ref.get("where", label),
                               source=label)
        add_enrolment(p, course, label, raw=clean(ref.get("raw")), dog=dog,
                      did_not_attend=bool(ref.get("didNotAttend")),
                      prior_provider=bool(ref.get("priorProvider")),
                      source_row=clean(ref.get("sourceRow")))
        if ref.get("comment"):
            p.add_note(f"{ref.get('raw')} — {ref['comment']}", label)

    for ref in pf.get("consults") or []:
        add_consult(p, ref, label, cfg.service_names)
        stats["consults"] += 1

    for r in pf.get("roles") or []:
        _set_custom(p, cfg, "volunteer", "Yes")
        stats[f"volunteerRefsFrom_{label}"] += 1
        p.add_note(f"Role: {r.get('raw')}", label)

    credit_label = cfg.custom_field("credit")
    for cr in pf.get("credits") or []:
        if not credit_label:
            break
        existing = p.custom.get(credit_label, "")
        p.custom[credit_label] = (f"{existing} | {cr}".strip(" |") if existing
                                  else cr)

    for ac in pf.get("accessCodes") or []:
        if ac not in p.access_codes:
            p.access_codes.append(ac)
    for af in pf.get("afRefs") or []:
        if af not in p.af_refs:
            p.af_refs.append(af)

    for h in pf.get("addressHints") or []:
        if not p.fields.get("address"):
            p.set_field("address", h, label, reg)
        else:
            p.add_note(f"Address hint: {h}", label)

    # Rule: nothing is silently dropped.
    for line in pf.get("unclassified") or []:
        p.add_note(line, label)
    for line in pf.get("freeText") or []:
        p.add_note(line, label)

    for k, v in (pf.get("customFields") or {}).items():
        p.custom[k] = v
    if pf.get("subscriber") is not None:
        p.subscriber = pf["subscriber"]

    if any(r.get("priorProvider") for r in pf.get("courseRefs") or []):
        _set_custom(p, cfg, "previousTrainer", "Yes")
        stats["previousTrainerPeople"] += 1


def _apply_waitlist(p: Person, entry: dict, judge: DogNameJudge, label: str,
                    reg: Registry, cfg: ClientConfig) -> None:
    """
    A waitlist row, whose dog and breed columns are swapped constantly.

    Take only what reads like a name, and keep both raw values in the notes
    either way — a value with a digit in it ("born 29th August") is a fact
    about the dog, not its name.
    """
    p.waitlist.append({k: entry.get(k) for k in
                       ("category", "sourceRow", "breedAge", "dogRaw", "notes")})
    dog_raw = clean(entry.get("dogRaw"))
    breed_raw = clean(entry.get("breedAge"))
    dn = judge.usable(dog_raw, owner=p.fields.get("name", ""), person=p,
                      where="the waitlist dog column")
    if dn and re.search(r"\d", dn):
        p.add_note(f"Waitlist dog column: {dog_raw}", label)
        dn = ""
    if dn or breed_raw:
        merge_dog(p, name=dn,
                  breed=breed_raw if not re.search(r"\d", breed_raw) else "",
                  source=label, registry=reg, aliases=cfg.breed_aliases)
    if breed_raw and re.search(r"\d", breed_raw):
        p.add_note(f"Waitlist breed/age column: {breed_raw}", label)
    p.add_note(entry.get("notes"), label)
    if entry.get("category"):
        p.add_note(f"On the waitlist for: {entry['category']}", label)


def _resolve_course(ref: dict, catalogue: CourseCatalogue, who: str,
                    stats: Counter, label: str):
    """An exact id if the source knew one, else a fuzzy match, else invent."""
    if ref.get("externalId") is not None:
        return catalogue.courses.get(f"S{ref['externalId']}")
    if not any([ref.get("nicknameKey"), ref.get("code"), ref.get("month"),
                ref.get("year")]):
        return None
    course = catalogue.match_ref(ref, who)
    if course is None:
        course = catalogue.invent_for(ref)
        stats[f"{label}RefsInvented"] += 1
    else:
        stats[f"{label}RefsMatched"] += 1
    return course


def _set_custom(p: Person, cfg: ClientConfig, key: str, value: str) -> None:
    label = cfg.custom_field(key)
    if label:
        p.custom[label] = value


_ROLE_RE_CACHE: dict[tuple, re.Pattern] = {}


def _role_re(cfg: ClientConfig) -> re.Pattern:
    key = tuple(cfg.role_words)
    if key not in _ROLE_RE_CACHE:
        _ROLE_RE_CACHE[key] = re.compile(
            r"\b(" + "|".join(re.escape(w) for w in key) + r"|on placement)\b",
            re.I)
    return _ROLE_RE_CACHE[key]
