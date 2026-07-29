"""
The notes-blob parser — turn a free-text lump into structured facts.

WHY THIS EXISTS
---------------
The richest data in a small business is almost never in a column. It is in the
Notes field of a contacts export: one cell holding twenty lines typed over
three years, each line a different KIND of fact.

    Teddy - Yorkshire Terrier
    SP's January 2026 - The Welsh Corgi's
    ELP Jan 2025 'Yorkshire Terriers' - CREDIT $120
    DTP November 2024
    Lock box code 4821
    AF #1042
    Intern, summer 2025
    Address: Pyes Pa

Thrown away, that is most of the client's history. Parsed into a single
"notes" string, it is unsearchable and unimportable. So we read it line by
line and classify each line, and the leftovers survive verbatim.

THE RULES THAT MATTER
---------------------
1. **A line can be more than one thing.** A credit note is recorded AND left
   available to the class parser, because "SP Nov 2024 - The Ridgebacks -
   CREDIT $120" is genuinely both.
2. **A confident dog line is tested before the service codes**, because
   "Loki - Boxer X Bulldog (ADT PP Jack Russell's)" mentions a service code
   inside a breed. Confidence means "the breed is one we have already seen in
   this client's own breed columns" — a vocabulary learned from the data.
3. **The dog separator must be a SPACED dash.** "Bee-ga-Boo - Beagle X Cocker"
   splits once, not three times.
4. **Nothing is dropped.** Every line that no rule claims lands in `freeText`
   and `unclassified`; the merge engine writes both onto the person.

Everything client-specific (class codes, service codes, role words, the name
of the previous trainer) arrives as a `NotesGrammar`. The parsing logic is
the reusable part; the vocabulary is per-client config.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from .text import MONTH_RE, month_year, norm_breed, norm_name, norm_nickname

# ---------------------------------------------------------------------------
# Grammar
# ---------------------------------------------------------------------------


@dataclass
class NotesGrammar:
    """
    The client's own shorthand.

    course_codes    {"SP": "School Pups", ...} — the code they type, and the
                    class level it means. Both the code and the level name are
                    accepted at the start of a line.
    service_codes   1:1 / in-home service codes, matched as whole words.
    service_phrases lowercase phrases that mean the same thing in prose.
    role_words      words that mark a helper rather than a client.
    prior_providers words naming a previous trainer, so their classes can be
                    kept out of this client's own class history.
    """
    course_codes: dict[str, str] = field(default_factory=dict)
    service_codes: tuple[str, ...] = ()
    service_names: dict[str, str] = field(default_factory=dict)
    service_phrases: tuple[str, ...] = ()
    role_words: tuple[str, ...] = ("intern", "volunteer", "placement")
    prior_providers: tuple[str, ...] = ()
    nickname_junk_extra: tuple[str, ...] = ()
    reference_tag: str = "AF"
    access_code_words: tuple[str, ...] = (
        "lock box", "door code", "gate code", "key pad", "keysafe", "key safe",
    )

    # -- derived patterns, built once -------------------------------------
    def __post_init__(self) -> None:
        codes = list(self.course_codes)
        # "School Pups" must also match "School  Pups". Built by joining the
        # escaped words, NOT by re.sub-ing a replacement — a backslash in a
        # replacement string is itself an escape, and doubling it silently
        # produces a pattern that matches nothing.
        levels = [r"\s+".join(re.escape(t) for t in lvl.split())
                  for lvl in self.course_codes.values()]
        alts = "|".join(re.escape(c) for c in codes)
        if levels:
            alts = (alts + "|" if alts else "") + "|".join(levels)
        prefix = ""
        if self.prior_providers:
            prefix = "(?:" + _loose_alt(self.prior_providers) + r")\s+"
        # One expression so the caller gets (code, remainder) in a single pass.
        self.course_line_re = re.compile(
            r"^(?:" + prefix + r")?(" + alts + r")(?:['’]?s)?\b[\s.:,-]*(.*)$"
            if prefix else
            r"^(" + alts + r")(?:['’]?s)?\b[\s.:,-]*(.*)$",
            re.I,
        ) if alts else None
        self.course_alias = {re.sub(r"\s+", " ", lvl).lower(): code
                             for code, lvl in self.course_codes.items()}
        self.service_word_re = [
            (c, re.compile(r"\b" + re.escape(c) + r"\b", re.I))
            for c in self.service_codes
        ]
        self.prior_re = (re.compile(_loose_alt(self.prior_providers), re.I)
                         if self.prior_providers else None)
        self.access_re = (re.compile(_loose_alt(self.access_code_words, word=False),
                                     re.I)
                          if self.access_code_words else None)
        self.af_re = re.compile(
            r"\b" + re.escape(self.reference_tag) + r"\s*#\s*(\d+)?", re.I)
        self.af_only_re = re.compile(
            r"^" + re.escape(self.reference_tag) + r"\s*#?\s*\d*$", re.I)
        self.dog_course_re = re.compile(
            r"^(?P<names>[^-–—]{1,30}?)\s+[-–—]\s+(?P<course>(?:"
            + ("|".join(re.escape(c) for c in codes) if codes else r"(?!)")
            + r")\b.*)$",
            re.I,
        )
        self.nickname_junk = (
            {"the"}
            | {c.lower() for c in codes}
            | {c.lower() + "s" for c in codes}
            | {norm_nickname(p) for p in self.prior_providers}
            | {norm_nickname(x) for x in self.nickname_junk_extra}
        )


def _loose_alt(words, word: bool = True) -> str:
    """
    Alternation over phrases, tolerating the spacing people actually type.

    A space in a configured phrase becomes `\\s*`, so "door code" also matches
    "doorcode". `word=True` adds word boundaries so a code like "ADT" cannot
    match inside a longer word.
    """
    parts = []
    for w in words:
        pat = r"\s*".join(re.escape(t) for t in w.split())
        if word and re.match(r"^\w", w) and re.search(r"\w$", w):
            pat = r"\b" + pat + r"\b"
        parts.append(pat)
    return "|".join(parts)


# ---------------------------------------------------------------------------
# Line-shape patterns that are not client-specific
# ---------------------------------------------------------------------------

# A dash-separated "Name - Breed" line. The separator must be SPACED so a
# hyphenated dog name survives intact.
DOG_LINE_RE = re.compile(r"^(?P<names>.{1,60}?)\s+[-–—]\s+(?P<breed>.+)$")
NAME_TOKEN_RE = re.compile(r"^[A-Za-z][A-Za-z'’.\-]*$")

# Things that can follow "X - " and are definitely not a breed.
NOT_A_BREED_RE = re.compile(
    r"promo|video|photo|picture|invoice|package|session|walk|meeting|quote|"
    r"sponsor|website|social|discount|voucher|deposit|booking|email|phone|"
    r"referral|assessment|seminar|workshop|donation", re.I)

# Outlook's own import scaffolding, and re-stated address columns.
IMPORT_NOISE_RE = re.compile(
    r"^(-{3,}|Contact Imported:?|(Other|Home|Business)\s+(Street|City|"
    r"Postal Code|Country/Region)\s*:.*)$", re.I)
ADDRESS_HINT_RE = re.compile(r"^Address\s*(?:\([^)]*\))?\s*:\s*(.+)$", re.I)

CREDIT_RE = re.compile(r"\bcredit(ed)?\b|\brefund", re.I)

# Words that mean "this segment is a comment, not the class nickname".
NICK_STOPWORDS = re.compile(
    r"credit|refund|attend|enrol|register|missed|week|class|session|paid|"
    r"cancel|move|swap|defer|withdraw|nervous|late|\$", re.I)

NON_ATTEND_RE = re.compile(
    r"(register|enrol)(ed)?\s+but\s+(did\s*n[o']?t|didn['’]?t|did\s+not)\s+attend"
    r"|did\s*n[o']?t\s+attend|didn['’]?t\s+attend", re.I)

# "RIP" is deliberately absent: there is a real dog called Rip.
DECEASED_RE = re.compile(r"\bPTS\b|passed away|\bdied\b", re.I)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def split_dog_names(raw: str) -> list[str] | None:
    """
    "Toby & Bentley" -> ["Toby", "Bentley"];  "Forrest (Foz)" -> unchanged.
    None when the left-hand side does not read like dog name(s) at all.
    """
    raw = raw.strip().strip('"')
    if not raw:
        return None
    out = []
    for p in re.split(r"\s*(?:&|\+|\band\b|/)\s*", raw):
        p = p.strip()
        if not p:
            continue
        core = re.sub(r"\(.*?\)", "", p).strip()
        toks = core.split()
        if not toks or len(toks) > 3 or len(core) > 24:
            return None
        if not all(NAME_TOKEN_RE.match(t) for t in toks):
            return None
        out.append(p)
    return out or None


def extract_nickname(rest: str) -> tuple[str | None, str | None]:
    """
    Pull the class nickname out of whatever followed the class code.
    Returns (nickname, leftover comment); either may be None.
    """
    text = rest.strip()
    if not text:
        return None, None

    # A quoted nickname wins outright: ELP Jan 2025 'Yorkshire Terriers'.
    m = re.search(r"['\"“‘]([^'\"”’]{3,40})['\"”’]\s*$", text)
    if m and not NICK_STOPWORDS.search(m.group(1)):
        cand = m.group(1).strip()
        if not re.fullmatch(r"[\d\s/]+", cand):
            return cand, None

    segs = [s.strip() for s in re.split(r"\s[-–—]\s|\s*[-–—]\s", text) if s.strip()]
    nickname = None
    leftovers = []
    for seg in segs:
        core = re.sub(r"\(.*?\)", " ", seg).strip(" '\"“”‘’.,")
        looks_like_name = (
            core
            and nickname is None
            and not NICK_STOPWORDS.search(core)
            and not re.search(r"\d", core)
            and not re.fullmatch(
                r"(?:" + MONTH_RE + r")[a-z]*(?:\s*/\s*(?:" + MONTH_RE + r")[a-z]*)?",
                core, re.I)
            and 3 <= len(core) <= 40
            and len(core.split()) <= 4
        )
        if looks_like_name:
            nickname = core
        elif not re.fullmatch(
                r"(?:(?:" + MONTH_RE + r")[a-z]*|20\d{2}|[/\s,]+)+", seg, re.I):
            leftovers.append(seg)

    return nickname, (" | ".join(leftovers) if leftovers else None)


def try_dog_line(line: str, breed_vocab: set[str], require_known_breed: bool,
                 aliases: dict[str, str] | None = None) -> list[dict] | None:
    """
    Parse "Teddy - Yorkshire Terrier" / "Toby & Bentley - Dachshund (brothers)".

    With `require_known_breed` the breed must be one already seen in this
    client's own breed columns, which is what makes it safe to run this test
    BEFORE the service-code test (see rule 2 in the module docstring).
    """
    m = DOG_LINE_RE.match(line)
    if not m:
        return None
    names = split_dog_names(m.group("names"))
    if not names:
        return None
    rest = m.group("breed").strip()
    if not rest:
        return None

    # "Labrador X Pit - PTS 21/07/25" -> breed + trailing note. Dashes inside
    # brackets are left alone.
    depth, buf, parts, i = 0, [], [], 0
    while i < len(rest):
        ch = rest[i]
        if ch in "([":
            depth += 1
        elif ch in ")]":
            depth = max(0, depth - 1)
        if (depth == 0 and ch in "-–—" and i > 0 and i + 1 < len(rest)
                and rest[i - 1] == " " and rest[i + 1] == " "):
            parts.append("".join(buf).strip())
            buf = []
            i += 1
            continue
        buf.append(ch)
        i += 1
    parts.append("".join(buf).strip())
    parts = [p for p in parts if p]

    breed = parts[0] if parts else rest
    note = " | ".join(parts[1:]) or None
    core = norm_breed(breed, aliases)

    if require_known_breed:
        if core not in breed_vocab and not (set(core.split()) & breed_vocab):
            return None
    else:
        # Generic pass: the right-hand side must at least be breed-SHAPED, or
        # "Sena Pictures - Promo videos" becomes a dog.
        if NOT_A_BREED_RE.search(breed):
            return None
        if not core or len(core.split()) > 5:
            return None
        if re.match(r"^(?:" + MONTH_RE + r")\b", breed.strip(), re.I):
            return None
        if re.fullmatch(r"[\d\s/.\-]+", breed.strip()):
            return None

    deceased = bool(DECEASED_RE.search(line))
    return [{"name": n, "breed": breed, "note": note, "deceased": deceased,
             "raw": line} for n in names]


# ---------------------------------------------------------------------------
# The parser
# ---------------------------------------------------------------------------

EMPTY = ("dogs", "courses", "oneToOne", "roles", "afRefs", "addressHints",
         "accessCodes", "credits", "freeText", "unclassified")


def parse_notes(notes: str, grammar: NotesGrammar, *,
                breed_vocab: set[str] | None = None,
                suburb_vocab: set[str] | None = None,
                aliases: dict[str, str] | None = None) -> dict:
    """Split a notes blob into dogs / courses / services / roles / the rest."""
    breed_vocab = breed_vocab or set()
    suburb_vocab = suburb_vocab or set()
    res: dict = {k: [] for k in EMPTY}
    res["importNoiseLines"] = 0
    if not notes:
        return res

    for raw_line in notes.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        line = raw_line.strip()
        if not line:
            continue

        # Reference tags can ride along on any line — harvest first, always.
        for m in grammar.af_re.finditer(line):
            res["afRefs"].append(
                {"number": m.group(1), "raw": line, "bare": m.group(1) is None})

        if IMPORT_NOISE_RE.match(line):
            res["importNoiseLines"] += 1
            continue

        m = ADDRESS_HINT_RE.match(line)
        if m:
            res["addressHints"].append(m.group(1).strip())
            continue

        low = line.lower()

        # "Daisy - SP's January 2026 - the Vizsla's": a class, tagged to a dog.
        dog_for_course = None
        course_text = line
        dc = grammar.dog_course_re.match(line)
        if dc and split_dog_names(dc.group("names")):
            dog_for_course = dc.group("names").strip()
            course_text = dc.group("course").strip()

        is_course_line = bool(grammar.course_line_re
                              and grammar.course_line_re.match(course_text))
        has_service = (any(rx.search(line) for _, rx in grammar.service_word_re)
                       or any(p in low for p in grammar.service_phrases))

        # Money is recorded but does NOT consume the line (rule 1).
        if CREDIT_RE.search(line):
            res["credits"].append(line)
            if not (is_course_line or has_service):
                continue

        if grammar.access_re and grammar.access_re.search(line):
            res["accessCodes"].append(line)
            continue

        # Rule 2 — a confident dog line beats the service codes.
        if not is_course_line:
            dog = try_dog_line(line, breed_vocab, True, aliases)
            if dog:
                res["dogs"].extend(dog)
                continue

        # 1. Class reference
        if grammar.course_line_re:
            m = grammar.course_line_re.match(course_text)
            if m:
                code = re.sub(r"\s+", " ", m.group(1)).strip()
                code = grammar.course_alias.get(code.lower(), code.upper())
                nickname, comment = extract_nickname(m.group(2))
                month, year = month_year(course_text)
                res["courses"].append({
                    "code": code,
                    "month": month,
                    "year": year,
                    "nickname": nickname,
                    "nicknameKey": norm_nickname(nickname) if nickname else None,
                    "dog": dog_for_course,
                    "comment": comment,
                    "priorProvider": bool(grammar.prior_re
                                          and grammar.prior_re.search(line)),
                    "didNotAttend": bool(NON_ATTEND_RE.search(line)),
                    "raw": line,
                })
                continue

        # 2. 1:1 / in-home service reference
        svc = next((c for c, rx in grammar.service_word_re if rx.search(line)), None)
        if svc is None and any(p in low for p in grammar.service_phrases):
            svc = "IN-HOME"
        if svc:
            month, year = month_year(line)
            res["oneToOne"].append(
                {"code": svc, "month": month, "year": year, "raw": line})
            continue

        # 3. Helper / volunteer / placement
        if any(w in low for w in grammar.role_words):
            month, year = month_year(line)
            kind = next(w for w in grammar.role_words if w in low)
            res["roles"].append(
                {"kind": kind, "month": month, "year": year, "raw": line})
            continue

        # 4. A bare reference tag — already harvested above.
        if grammar.af_only_re.fullmatch(line):
            continue

        # 5. Dog line, generic pass
        dog = try_dog_line(line, breed_vocab, False, aliases)
        if dog:
            res["dogs"].extend(dog)
            continue

        # 6. Breed with no dog name ("Labradoodle", "Rescue dog")
        if norm_breed(line, aliases) in breed_vocab or re.fullmatch(
                r"(rescue|foster|second|new)\s+(dog|pup|puppy)", low):
            res["dogs"].append({"name": None, "breed": line, "note": None,
                                "deceased": False, "raw": line})
            continue

        # 7. A bare suburb is an address hint, not a note.
        if norm_name(line) in suburb_vocab and len(line) <= 30:
            res["addressHints"].append(line)
            continue

        # 8. Anything else survives verbatim (rule 4).
        res["freeText"].append(line)
        if not re.fullmatch(r"[\W_]+", line):
            res["unclassified"].append(line)

    return res
