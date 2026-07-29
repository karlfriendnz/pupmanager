#!/usr/bin/env python3
"""
parse_contacts.py — READ-ONLY conflict analysis for the PRIME PUPS data import.

Reads:
  /Users/karl/Downloads/contacts.csv          Outlook contacts export (multi-line quoted Notes)
  /Users/karl/Desktop/Temp/prime_extracted.json  existing spreadsheet extraction
  /Users/karl/Downloads/profiles.csv          Squarespace subscriber export
  /Users/karl/Downloads/professionals.csv     pet-industry professionals

Writes:
  /Users/karl/Desktop/Temp/contacts_parsed.json   structured contact records
  /Users/karl/Desktop/Temp/import_conflicts.md    plain-English conflict report

Touches no database, mutates no input, edits no other file.
"""

from __future__ import annotations

import csv
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

csv.field_size_limit(10 ** 7)

CONTACTS_CSV = Path("/Users/karl/Downloads/contacts.csv")
PRIME_JSON = Path("/Users/karl/Desktop/Temp/prime_extracted.json")
PROFILES_CSV = Path("/Users/karl/Downloads/profiles.csv")
PROFESSIONALS_CSV = Path("/Users/karl/Downloads/professionals.csv")

OUT_DIR = Path("/Users/karl/Desktop/Temp")
OUT_JSON = OUT_DIR / "contacts_parsed.json"
OUT_MD = OUT_DIR / "import_conflicts.md"

MAX_EXAMPLES = 15

# --------------------------------------------------------------------------
# Normalisation helpers
# --------------------------------------------------------------------------

MONTHS = (
    "January February March April May June July August September October "
    "November December"
).split()
MONTH_RE = "|".join(MONTHS) + "|" + "|".join(m[:3] for m in MONTHS)

# Course codes that map onto the spreadsheet's three class sheets.
COURSE_CODES = {"SP": "School Pups", "ELP": "Early Learning", "TT": "Top Teens"}
# 1:1 / in-home service codes. The first five are the ones the brief names;
# the rest are real codes found in the data and kept so nothing is dropped.
SERVICE_CODES = ["DTS", "DTP", "PFP", "PFS", "TW", "ADT", "OC"]
SERVICE_PHRASES = ["in-home", "in home", "1:1", "one to one", "training walk",
                   "package"]
# Things that can follow "X - " but are definitely not a breed.
NOT_A_BREED_RE = re.compile(
    r"promo|video|photo|picture|invoice|package|session|walk|meeting|quote|"
    r"sponsor|website|social|discount|voucher|deposit|booking|email|phone|"
    r"referral|assessment|seminar|workshop|donation",
    re.I,
)
ROLE_WORDS = ["intern", "volunteer", "placement"]


def norm_email(v: str | None) -> str:
    return (v or "").strip().lower()


def norm_name(v: str | None) -> str:
    """Lowercase, drop punctuation, collapse whitespace — for person matching."""
    s = (v or "").lower()
    s = s.replace("&", " and ")
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def norm_nickname(v: str | None) -> str:
    """
    Course-nickname key: case-insensitive, apostrophes stripped, a leading
    'the' dropped and a trailing plural 's' removed, so
      "The Fox Terrier's" == "The Fox Terriers" == "the fox terrier's"
    """
    s = (v or "").lower()
    s = s.replace("’", "'").replace("'", "")
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    if s.startswith("the "):
        s = s[4:]
    words = s.split()
    if words and len(words[-1]) > 3 and words[-1].endswith("s"):
        words[-1] = words[-1][:-1]
    return " ".join(words)


def _edit_distance_le1(a: str, b: str) -> bool:
    """True when a and b differ by at most one insert / delete / substitution."""
    la, lb = len(a), len(b)
    if abs(la - lb) > 1:
        return False
    if a == b:
        return True
    if la == lb:
        return sum(1 for x, y in zip(a, b) if x != y) == 1
    if la > lb:
        a, b, la, lb = b, a, lb, la
    i = j = 0
    skipped = False
    while i < la and j < lb:
        if a[i] == b[j]:
            i += 1
            j += 1
        elif skipped:
            return False
        else:
            skipped = True
            j += 1
    return True


def resolve_nickname(key: str, prime_keys) -> tuple[str | None, str]:
    """
    Match a contacts-file class nickname to a spreadsheet one.
    Returns (matched_key, how) — how is exact / prefix / tokens / spelling.
    """
    if not key:
        return None, ""
    if key in prime_keys:
        return key, "exact"
    kt = set(key.split())
    for pk in prime_keys:
        if len(key) >= 4 and len(pk) >= 4 and (key.startswith(pk) or pk.startswith(key)):
            return pk, "prefix"
    for pk in prime_keys:
        pt = set(pk.split())
        if kt and pt and (kt <= pt or pt <= kt):
            return pk, "tokens"
    for pk in prime_keys:
        if len(key) >= 5 and _edit_distance_le1(key, pk):
            return pk, "spelling"
    return None, ""


def digits(v: str | None) -> str:
    """Phone comparison key: digits only, +64 / 0064 folded back to a leading 0."""
    s = re.sub(r"[^\d+]", "", (v or ""))
    s = re.sub(r"^\+?64", "0", s)
    s = re.sub(r"^00", "0", s)
    s = re.sub(r"\D", "", s)
    # A NZ number written as 64211234567 without the plus.
    if len(s) > 10 and s.startswith("64"):
        s = "0" + s[2:]
    return s


def plausible_nz_phone(raw: str | None) -> tuple[bool, str]:
    """Return (ok, reason). Mobiles start 02, landlines 03/04/06/07/09."""
    d = digits(raw)
    if not d:
        return True, ""
    if not d.startswith("0"):
        return False, "does not start with 0 (or +64)"
    if d.startswith("02"):
        if not (9 <= len(d) <= 11):
            return False, f"mobile has {len(d)} digits (expected 9-11)"
        return True, ""
    if d[1] in "34679":
        if not (9 <= len(d) <= 10):
            return False, f"landline has {len(d)} digits (expected 9-10)"
        return True, ""
    return False, f"unrecognised NZ prefix 0{d[1]}"


MACRONS = str.maketrans("āēīōūĀĒĪŌŪ", "aeiouAEIOU")


def norm_street(v: str | None) -> str:
    """First address line, lowercased, punctuation-free — for address comparison."""
    s = (v or "").translate(MACRONS)
    s = s.replace("\r", "\n").split("\n")[0]
    s = s.split(",")[0]
    s = s.lower()
    s = re.sub(r"\b(road|rd)\b", "rd", s)
    s = re.sub(r"\b(street|st)\b", "st", s)
    s = re.sub(r"\b(avenue|ave)\b", "ave", s)
    s = re.sub(r"\b(place|pl)\b", "pl", s)
    s = re.sub(r"\b(drive|dr)\b", "dr", s)
    s = re.sub(r"\b(crescent|cres)\b", "cres", s)
    s = re.sub(r"[^a-z0-9 ]+", "", s)
    return re.sub(r"\s+", " ", s).strip()


ROAD_TYPES = {"rd", "st", "ave", "pl", "dr", "cres", "cresent", "lane", "way",
              "terrace", "grove", "close", "court", "boulevard", "parade",
              "track", "dell", "avenue"}


def _street_key(v: str | None) -> tuple[str, str]:
    """(house number, street name without its road-type word)."""
    s = norm_street(v)
    if not s:
        return "", ""
    toks = s.split()
    num = toks[0] if toks and re.match(r"^\d", toks[0]) else ""
    words = [t for t in toks[1:] if t not in ROAD_TYPES and not re.fullmatch(
        r"rd\d*|\d+", t)]
    return num, " ".join(words[:2])


def addresses_agree(a: str | None, b: str | None) -> bool:
    """
    Same address? Tolerates 'Road' vs 'Rd', 'RD 8 Tauranga' rural suffixes,
    a suburb where the other has a city, and a single-character typo in the
    street name — but NOT a different house number or a different street.
    """
    x, y = norm_street(a), norm_street(b)
    if not x or not y:
        return True
    if x == y or x in y or y in x:
        return True
    nx, sx = _street_key(a)
    ny, sy = _street_key(b)
    if not sx or not sy:
        return False
    if nx != ny:
        return False
    return sx == sy or sx in sy or sy in sx or _edit_distance_le1(sx, sy)


# The two sources write the same breed very differently — "Staffy" vs
# "Staffordshire Bull Terrier", "GSP" vs "German Shorthaired Pointer".
BREED_ALIASES = {
    "staffy": "staffordshire bull terrier",
    "staffie": "staffordshire bull terrier",
    "sbt": "staffordshire bull terrier",
    "gsp": "german shorthaired pointer",
    "gsd": "german shepherd",
    "bc": "border collie",
    "gr": "golden retriever",
    "lab": "labrador",
    "labradore": "labrador",
    "jr": "jack russell",
    "jrt": "jack russell",
    "mini": "miniature",
    "min": "miniature",
    "cav": "cavalier",
    "hunt": "huntaway",
    "cross": "x",
}
# Values that say nothing — treat as missing, not as a disagreement.
VAGUE_BREEDS = {"mixed", "mixed breed", "mix", "unknown", "x", "crossbreed",
                "cross breed", "rescue", "rescue dog", "dog", "puppy", "pup",
                "tbc", "n a"}


def norm_breed(v: str | None) -> str:
    s = (v or "").lower()
    s = re.sub(r"\(.*?\)", " ", s)
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    words = [BREED_ALIASES.get(w, w) for w in s.split()]
    return re.sub(r"\s+", " ", " ".join(words)).strip()


def breeds_agree(a: str, b: str) -> bool:
    x, y = norm_breed(a), norm_breed(b)
    if not x or not y:
        return True
    if x in VAGUE_BREEDS or y in VAGUE_BREEDS:
        return True
    if x == y or x in y or y in x:
        return True
    xs = set(x.split()) - {"x", "dog", "puppy", "pup"}
    ys = set(y.split()) - {"x", "dog", "puppy", "pup"}
    if xs & ys:
        return True
    # One-word typo tolerance ("Dogg" vs "Bulldog" stays a conflict).
    return any(_edit_distance_le1(p, q) and len(p) > 4 for p in xs for q in ys)


# --------------------------------------------------------------------------
# Notes-blob parser
# --------------------------------------------------------------------------

AF_RE = re.compile(r"\bAF\s*#\s*(\d+)?", re.I)
# "SP", "SP's", "ELP", "TT" at the start of the line — the rest is parsed loosely
# because the wording varies enormously ("SP Journey Sept 2024 - The Greyhounds",
# "ELP Jan 2025 'Yorkshire Terriers'", "SP's January 2026 - The Welsh Corgi's").
COURSE_RE = re.compile(
    r"^(?:Allsorts\s+)?"
    r"(SP|ELP|TT|School\s+Pups|Early\s+Learning|Top\s+Teens)"
    r"(?:['’]?s)?\b[\s.:,-]*(.*)$",
    re.I,
)
COURSE_ALIASES = {
    "school pups": "SP",
    "early learning": "ELP",
    "top teens": "TT",
}
IMPORT_NOISE_RE = re.compile(
    r"^(-{3,}|Contact Imported:?|(Other|Home|Business)\s+(Street|City|"
    r"Postal Code|Country/Region)\s*:.*)$",
    re.I,
)
ADDRESS_HINT_RE = re.compile(r"^Address\s*(?:\([^)]*\))?\s*:\s*(.+)$", re.I)
ACCESS_CODE_RE = re.compile(
    r"(lock\s?box|door\s*code|gate\s*code|key\s?pad|keysafe|key\s?safe)", re.I
)
CREDIT_RE = re.compile(r"\bcredit(ed)?\b|\brefund", re.I)
# Words that mean "this bit is a comment, not the class nickname".
NICK_STOPWORDS = re.compile(
    r"credit|refund|attend|enrol|register|missed|week|class|session|paid|"
    r"cancel|move|swap|defer|withdraw|nervous|late|\$",
    re.I,
)
# Classes taken with a previous trainer — they will never be in the spreadsheet.
PRIOR_PROVIDER_RE = re.compile(
    r"allsorts|\bADT\b|journey|cliff\s*road|neewood", re.I
)
NON_ATTEND_RE = re.compile(
    r"(register|enrol)(ed)?\s+but\s+(did\s*n[o']?t|didn['’]?t|did\s+not)\s+attend"
    r"|did\s*n[o']?t\s+attend|didn['’]?t\s+attend",
    re.I,
)
# The separator must be a SPACED dash, so a hyphenated dog name
# ("Bee-ga-Boo - Beagle X Cocker Spaniel") is not split down the middle.
DOG_LINE_RE = re.compile(r"^(?P<names>.{1,60}?)\s+[-–—]\s+(?P<breed>.+)$")
NAME_TOKEN_RE = re.compile(r"^[A-Za-z][A-Za-z'’.\-]*$")


def _month_year(text: str) -> tuple[str | None, str | None]:
    m = re.search(r"(" + MONTH_RE + r")[a-z]*", text, re.I)
    y = re.search(r"(20\d{2})", text)
    month = None
    if m:
        stem = m.group(1).lower()[:3]
        month = next((x for x in MONTHS if x.lower().startswith(stem)), None)
    return month, (y.group(1) if y else None)


def _extract_nickname(rest: str) -> tuple[str | None, str | None]:
    """
    Pull the class nickname out of everything that followed the SP/ELP/TT code.
    Returns (nickname, leftoverComment). Either may be None.
    """
    text = rest.strip()
    if not text:
        return None, None

    # A quoted nickname wins outright: ELP Jan 2025 'Yorkshire Terriers'
    m = re.search(r"['\"“‘]([^'\"”’]{3,40})['\"”’]\s*$", text)
    if m and not NICK_STOPWORDS.search(m.group(1)):
        cand = m.group(1).strip()
        if not re.fullmatch(r"[\d\s/]+", cand):
            return cand, None

    # Otherwise walk the dash-separated segments and take the first that reads
    # like a name rather than a comment.
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
                core,
                re.I,
            )
            and 3 <= len(core) <= 40
            and len(core.split()) <= 4
        )
        if looks_like_name:
            nickname = core
        elif not re.fullmatch(
            r"(?:(?:" + MONTH_RE + r")[a-z]*|20\d{2}|[/\s,]+)+", seg, re.I
        ):
            leftovers.append(seg)

    comment = " | ".join(leftovers) if leftovers else None
    return nickname, comment


def _split_dog_names(raw: str) -> list[str] | None:
    """
    'Toby & Bentley'  -> ['Toby', 'Bentley']
    'Forrest (Foz)'   -> ['Forrest (Foz)']
    Returns None when the left-hand side does not look like dog name(s).
    """
    raw = raw.strip().strip('"')
    if not raw:
        return None
    # Strip a trailing parenthetical qualifier but keep an alias in place.
    parts = re.split(r"\s*(?:&|\+|\band\b|/)\s*", raw)
    out = []
    for p in parts:
        p = p.strip()
        if not p:
            continue
        core = re.sub(r"\(.*?\)", "", p).strip()
        toks = core.split()
        if not toks or len(toks) > 3:
            return None
        if not all(NAME_TOKEN_RE.match(t) for t in toks):
            return None
        if len(core) > 24:
            return None
        out.append(p)
    return out or None


# "RIP" is deliberately excluded — there is a dog actually called Rip.
DECEASED_RE = re.compile(r"\bPTS\b|passed away|\bdied\b", re.I)
# "Daisy - SP's January 2026 - the Vizsla's" — a class tagged to one dog.
DOG_COURSE_RE = re.compile(
    r"^(?P<names>[^-–—]{1,30}?)\s+[-–—]\s+(?P<course>(SP|ELP|TT)\b.*)$", re.I
)


def _try_dog_line(line: str, breed_vocab: set[str],
                  require_known_breed: bool) -> list[dict] | None:
    """
    Parse "Teddy - Yorkshire Terrier" / "Toby & Bentley - Dachshund (brothers)".
    With require_known_breed the breed must be one seen in the spreadsheet, which
    makes the rule safe to run before the service-code rule.
    """
    m = DOG_LINE_RE.match(line)
    if not m:
        return None
    names = _split_dog_names(m.group("names"))
    if not names:
        return None
    rest = m.group("breed").strip()
    if not rest:
        return None
    # "Labrador X Pit - PTS 21/07/25" -> breed + trailing note.
    # Dashes inside brackets are left alone.
    depth, buf, parts = 0, [], []
    i = 0
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
    core = norm_breed(breed)
    if require_known_breed:
        tokens = set(core.split())
        if core not in breed_vocab and not (tokens & breed_vocab):
            return None
    else:
        # Generic pass — the right-hand side must at least be breed-SHAPED,
        # or "Sena Pictures - Promo videos" becomes a dog.
        if NOT_A_BREED_RE.search(breed):
            return None
        if not core or len(core.split()) > 5:
            return None
        if re.match(r"^(?:" + MONTH_RE + r")\b", breed.strip(), re.I):
            return None
        if re.fullmatch(r"[\d\s/.\-]+", breed.strip()):
            return None
    deceased = bool(DECEASED_RE.search(line))
    return [
        {"name": n, "breed": breed, "note": note, "deceased": deceased,
         "raw": line}
        for n in names
    ]


def parse_notes(notes: str, breed_vocab: set[str],
                suburb_vocab: set[str] | None = None) -> dict:
    """Split a Notes blob into dogs / courses / oneToOne / roles / afRefs / freeText."""
    suburb_vocab = suburb_vocab or set()
    res = {
        "dogs": [],
        "courses": [],
        "oneToOne": [],
        "roles": [],
        "afRefs": [],
        "addressHints": [],
        "accessCodes": [],
        "credits": [],
        "importNoiseLines": 0,
        "freeText": [],
        "unclassified": [],
    }
    if not notes:
        return res

    for raw_line in notes.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        line = raw_line.strip()
        if not line:
            continue

        # AF references can ride along on any line — harvest first, always.
        for m in AF_RE.finditer(line):
            res["afRefs"].append(
                {"number": m.group(1), "raw": line, "bare": m.group(1) is None}
            )

        if IMPORT_NOISE_RE.match(line):
            res["importNoiseLines"] += 1
            continue

        m = ADDRESS_HINT_RE.match(line)
        if m:
            res["addressHints"].append(m.group(1).strip())
            continue

        low = line.lower()

        # "Daisy - SP's January 2026 - the Vizsla's": a class, tagged to a dog.
        dc = DOG_COURSE_RE.match(line)
        dog_for_course = None
        course_text = line
        if dc and _split_dog_names(dc.group("names")):
            dog_for_course = dc.group("names").strip()
            course_text = dc.group("course").strip()

        is_course_line = bool(COURSE_RE.match(course_text))
        has_service = any(
            re.search(r"\b" + c + r"\b", line, re.I) for c in SERVICE_CODES
        ) or any(p in low for p in SERVICE_PHRASES)

        # Money is recorded but does NOT consume the line — a note can be both
        # a credit and a class ("SP Nov 2024 - The Ridgebacks - CREDIT $120").
        if CREDIT_RE.search(line):
            res["credits"].append(line)
            if not (is_course_line or has_service):
                continue

        if ACCESS_CODE_RE.search(line):
            res["accessCodes"].append(line)
            continue

        # A confident dog line is checked before the service codes, because
        # "Loki - Boxer X Bulldog (ADT PP Jack Russell's)" mentions ADT.
        if not is_course_line:
            dog = _try_dog_line(line, breed_vocab, require_known_breed=True)
            if dog:
                res["dogs"].extend(dog)
                continue

        # 1. Course reference — SP / ELP / TT
        m = COURSE_RE.match(course_text)
        if m:
            code = re.sub(r"\s+", " ", m.group(1)).strip()
            code = COURSE_ALIASES.get(code.lower(), code.upper())
            nickname, comment = _extract_nickname(m.group(2))
            month, year = _month_year(course_text)
            res["courses"].append(
                {
                    "code": code,
                    "month": month,
                    "year": year,
                    "nickname": nickname,
                    "nicknameKey": norm_nickname(nickname) if nickname else None,
                    "dog": dog_for_course,
                    "comment": comment,
                    "priorProvider": bool(PRIOR_PROVIDER_RE.search(line)),
                    "didNotAttend": bool(NON_ATTEND_RE.search(line)),
                    "raw": line,
                }
            )
            continue

        # 2. 1:1 / in-home service reference
        svc = None
        for c in SERVICE_CODES:
            if re.search(r"\b" + c + r"\b", line, re.I):
                svc = c
                break
        if svc is None and any(p in low for p in SERVICE_PHRASES):
            svc = "IN-HOME"
        if svc:
            month, year = _month_year(line)
            res["oneToOne"].append(
                {"code": svc, "month": month, "year": year, "raw": line}
            )
            continue

        # 3. Intern / volunteer / placement
        if any(w in low for w in ROLE_WORDS):
            month, year = _month_year(line)
            kind = next(w for w in ROLE_WORDS if w in low)
            res["roles"].append(
                {"kind": kind, "month": month, "year": year, "raw": line}
            )
            continue

        # 4. Bare "AF" / "AF #" line — already harvested above.
        if re.fullmatch(r"AF\s*#?\s*\d*", line, re.I):
            continue

        # 5. Dog line "Name - Breed" (possibly two dogs sharing a breed)
        dog = _try_dog_line(line, breed_vocab, require_known_breed=False)
        if dog:
            res["dogs"].extend(dog)
            continue

        # 6. Breed-only line — no dog name given ("Labradoodle", "Rescue dog")
        if norm_breed(line) in breed_vocab or re.fullmatch(
            r"(rescue|foster|second|new)\s+(dog|pup|puppy)", low
        ):
            res["dogs"].append(
                {"name": None, "breed": line, "note": None,
                 "deceased": False, "raw": line}
            )
            continue

        # 7. A bare suburb name is an address hint, not a note.
        if norm_name(line) in suburb_vocab and len(line) <= 30:
            res["addressHints"].append(line)
            continue

        # 10. Anything else is preserved verbatim.
        res["freeText"].append(line)
        if not re.fullmatch(r"[\W_]+", line):
            res["unclassified"].append(line)

    return res


# --------------------------------------------------------------------------
# Loaders
# --------------------------------------------------------------------------


def load_contacts_raw() -> list[dict]:
    with CONTACTS_CSV.open(newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def pick_phone(row: dict) -> tuple[str, str]:
    """Content-based: named columns in priority order, first non-empty wins."""
    for col in (
        "Mobile Phone",
        "Business Phone",
        "Other Phone",
        "Primary Phone",
        "Home Phone",
        "Business Phone 2",
        "Home Phone 2",
        "Car Phone",
        "Company Main Phone",
    ):
        v = (row.get(col) or "").strip()
        if v:
            return v, col
    return "", ""


def pick_address(row: dict) -> dict:
    for prefix in ("Other", "Home", "Business"):
        street = (row.get(f"{prefix} Street") or "").strip()
        city = (row.get(f"{prefix} City") or "").strip()
        postcode = (row.get(f"{prefix} Postal Code") or "").strip()
        if street or city or postcode:
            return {
                "street": street,
                "city": city,
                "postcode": postcode,
                "source": prefix,
            }
    return {"street": "", "city": "", "postcode": "", "source": ""}


def build_breed_vocab(prime: dict) -> set[str]:
    vocab: set[str] = set()
    for e in prime.get("enrolments", []):
        b = norm_breed(e.get("breed"))
        if b:
            vocab.add(b)
            for w in b.split():
                if len(w) > 4:
                    vocab.add(w)
    return vocab


def build_suburb_vocab(rows: list[dict], prime: dict) -> set[str]:
    """Suburb names seen anywhere, so a bare 'Pyes Pa' line reads as an address."""
    vocab: set[str] = set()
    for row in rows:
        for col in ("Other City", "Home City", "Business City"):
            v = norm_name(row.get(col))
            if v:
                vocab.add(v)
        for m in re.finditer(r"^Address\s*(?:\([^)]*\))?\s*:\s*(.+)$",
                             row.get("Notes") or "", re.M | re.I):
            v = norm_name(m.group(1))
            if v and len(v.split()) <= 3:
                vocab.add(v)
    for c in prime.get("clients", []):
        for part in (c.get("address") or "").split(","):
            v = norm_name(part)
            if v and 1 <= len(v.split()) <= 3 and not re.search(r"\d", v):
                vocab.add(v)
    vocab.discard("")
    return vocab


def parse_contacts(prime: dict) -> list[dict]:
    breed_vocab = build_breed_vocab(prime)
    raw_rows = load_contacts_raw()
    suburb_vocab = build_suburb_vocab(raw_rows, prime)
    out = []
    for i, row in enumerate(raw_rows, start=2):  # 2 = first data row
        first = (row.get("First Name") or "").strip()
        last = (row.get("Last Name") or "").strip()
        email = norm_email(row.get("E-mail Address"))
        email2 = norm_email(row.get("E-mail 2 Address"))
        phone, phone_col = pick_phone(row)
        addr = pick_address(row)
        notes = row.get("Notes") or ""
        parsed = parse_notes(notes, breed_vocab, suburb_vocab)

        blank = not any(
            (v or "").strip() for v in row.values()
        )
        full = f"{first} {last}".strip()

        rec = {
            "rowNumber": i,
            "firstName": first,
            "lastName": last,
            "fullName": full,
            "nameKey": norm_name(full),
            "email": email,
            "emailKey": email,
            "email2": email2,
            "phone": phone,
            "phoneSource": phone_col,
            "phoneDigits": digits(phone),
            "company": (row.get("Company") or "").strip(),
            "street": addr["street"],
            "city": addr["city"],
            "postcode": addr["postcode"],
            "addressSource": addr["source"],
            "notesRaw": notes,
            "isBlankRow": blank,
            **{
                k: parsed[k]
                for k in (
                    "dogs",
                    "courses",
                    "oneToOne",
                    "roles",
                    "afRefs",
                    "addressHints",
                    "accessCodes",
                    "credits",
                    "freeText",
                    "unclassified",
                )
            },
            "importNoiseLines": parsed["importNoiseLines"],
        }
        out.append(rec)
    return out


def load_simple_csv(path: Path) -> list[dict]:
    with path.open(newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


# --------------------------------------------------------------------------
# Prime-side index
# --------------------------------------------------------------------------


def index_prime(prime: dict) -> dict:
    clients = prime.get("clients", [])
    enrolments = prime.get("enrolments", [])
    courses = prime.get("courses", [])

    by_email: dict[str, dict] = {}
    by_name: dict[str, dict] = {}
    for c in clients:
        e = norm_email(c.get("email"))
        n = norm_name(c.get("name"))
        if e and e not in by_email:
            by_email[e] = c
        if n and n not in by_name:
            by_name[n] = c

    # Enrolment-level dog/breed detail, keyed the same way.
    dogs_by_email: dict[str, list[dict]] = defaultdict(list)
    dogs_by_name: dict[str, list[dict]] = defaultdict(list)
    for en in enrolments:
        item = {"dog": en.get("dog"), "breed": en.get("breed")}
        e = norm_email(en.get("email"))
        n = norm_name(en.get("name"))
        if e:
            dogs_by_email[e].append(item)
        if n:
            dogs_by_name[n].append(item)

    courses_by_nick: dict[str, list[dict]] = defaultdict(list)
    for c in courses:
        k = norm_nickname(c.get("nickname"))
        if k:
            courses_by_nick[k].append(c)

    return {
        "clients": clients,
        "enrolments": enrolments,
        "courses": courses,
        "byEmail": by_email,
        "byName": by_name,
        "dogsByEmail": dogs_by_email,
        "dogsByName": dogs_by_name,
        "coursesByNick": courses_by_nick,
    }


def match_client(rec: dict, idx: dict) -> tuple[dict | None, str]:
    if rec["emailKey"] and rec["emailKey"] in idx["byEmail"]:
        return idx["byEmail"][rec["emailKey"]], "email"
    if rec["email2"] and rec["email2"] in idx["byEmail"]:
        return idx["byEmail"][rec["email2"]], "email2"
    if rec["nameKey"] and rec["nameKey"] in idx["byName"]:
        return idx["byName"][rec["nameKey"]], "name"
    return None, ""


def prime_dogs_for(rec: dict, client: dict, idx: dict) -> list[dict]:
    e = norm_email(client.get("email"))
    n = norm_name(client.get("name"))
    items = list(idx["dogsByEmail"].get(e, []))
    if not items:
        items = list(idx["dogsByName"].get(n, []))
    return items


# --------------------------------------------------------------------------
# Analysis
# --------------------------------------------------------------------------


def analyse(records: list[dict], prime: dict, profiles: list[dict],
            professionals: list[dict]) -> dict:
    idx = index_prime(prime)
    r: dict = {
        "fieldConflicts": {"phone": [], "address": [], "dogName": [], "breed": []},
        "gapFills": {"phone": [], "address": [], "dogName": [], "breed": []},
        "onlyInContacts": [],
        "onlyInSpreadsheet": [],
        "courseJoin": {"matched": 0, "matchedExact": 0, "matchedFuzzy": [],
                       "unmatched": [], "noNickname": [], "total": 0,
                       "codeMismatch": [], "priorProvider": [],
                       "didNotAttend": []},
        "credits": [],
        "accessCodes": 0,
        "newServices": Counter(),
        "newServiceExamples": defaultdict(list),
        "roles": [],
        "quality": {
            "duplicateEmails": [],
            "blankRows": [],
            "noEmail": [],
            "badPhones": [],
            "placeholderDogNames": [],
            "junkSpreadsheetDogNames": [],
            "unclassified": Counter(),
            "unclassifiedExamples": defaultdict(list),
        },
        "deceasedDogs": [],
        "overlap": {},
        "matchedCount": 0,
        "matchedByEmail": 0,
        "matchedByName": 0,
    }

    matched_client_keys: set[int] = set()

    # ---- duplicates / blanks / no-email ----
    email_rows = defaultdict(list)
    for rec in records:
        if rec["isBlankRow"]:
            r["quality"]["blankRows"].append(rec["rowNumber"])
            continue
        if rec["emailKey"]:
            email_rows[rec["emailKey"]].append(rec)
        else:
            r["quality"]["noEmail"].append(
                {"row": rec["rowNumber"], "name": rec["fullName"],
                 "phone": rec["phone"], "notes": rec["notesRaw"][:80]}
            )
    for e, rows in email_rows.items():
        if len(rows) > 1:
            r["quality"]["duplicateEmails"].append(
                {"email": e, "count": len(rows),
                 "names": [x["fullName"] for x in rows],
                 "rows": [x["rowNumber"] for x in rows]}
            )

    # ---- per-record comparison ----
    for rec in records:
        if rec["isBlankRow"]:
            continue

        ok, why = plausible_nz_phone(rec["phone"])
        if rec["phone"] and not ok:
            r["quality"]["badPhones"].append(
                {"name": rec["fullName"], "phone": rec["phone"],
                 "column": rec["phoneSource"], "reason": why}
            )

        for dg in rec["dogs"]:
            nm = (dg.get("name") or "").strip()
            if nm and (nm.upper() in {"TBC", "TBA", "N/A", "NA", "UNKNOWN"}
                       or nm.lower() in {"puppy", "pup", "dog"}):
                res_ph = {"name": rec["fullName"], "dogName": nm,
                          "breed": dg.get("breed")}
                r["quality"]["placeholderDogNames"].append(res_ph)
            if dg.get("deceased"):
                r["deceasedDogs"].append(
                    {"name": rec["fullName"], "dog": nm or "(unnamed)",
                     "raw": dg.get("raw")}
                )

        for line in rec["unclassified"]:
            key = line if len(line) < 60 else line[:57] + "..."
            r["quality"]["unclassified"][key] += 1
            if len(r["quality"]["unclassifiedExamples"][key]) < 3:
                r["quality"]["unclassifiedExamples"][key].append(rec["fullName"])

        for s in rec["oneToOne"]:
            r["newServices"][s["code"]] += 1
            if len(r["newServiceExamples"][s["code"]]) < MAX_EXAMPLES:
                r["newServiceExamples"][s["code"]].append(
                    {"name": rec["fullName"], "raw": s["raw"]}
                )
        for role in rec["roles"]:
            r["roles"].append(
                {"name": rec["fullName"], "email": rec["email"],
                 "kind": role["kind"], "raw": role["raw"]}
            )

        # ---- credits / access codes ----
        for line in rec["credits"]:
            r["credits"].append({"name": rec["fullName"], "raw": line})
        r["accessCodes"] += len(rec["accessCodes"])

        # ---- course join ----
        cj = r["courseJoin"]
        for co in rec["courses"]:
            cj["total"] += 1
            if co.get("priorProvider"):
                cj["priorProvider"].append(
                    {"name": rec["fullName"], "raw": co["raw"]}
                )
            if co.get("didNotAttend"):
                cj["didNotAttend"].append(
                    {"name": rec["fullName"], "raw": co["raw"]}
                )
            if not co["nicknameKey"]:
                cj["noNickname"].append(
                    {"name": rec["fullName"], "raw": co["raw"],
                     "priorProvider": co.get("priorProvider", False)}
                )
                continue
            hit_key, how = resolve_nickname(co["nicknameKey"], idx["coursesByNick"])
            if hit_key:
                cj["matched"] += 1
                if how == "exact":
                    cj["matchedExact"] += 1
                else:
                    cj["matchedFuzzy"].append(
                        {"name": rec["fullName"], "raw": co["raw"],
                         "contactsNickname": co["nickname"],
                         "spreadsheetNickname": idx["coursesByNick"][hit_key][0]
                         .get("nickname"),
                         "how": how}
                    )
                hits = idx["coursesByNick"][hit_key]
                want_sheet = COURSE_CODES.get(co["code"])
                if want_sheet and not any(h.get("sheet") == want_sheet for h in hits):
                    cj["codeMismatch"].append(
                        {"name": rec["fullName"], "raw": co["raw"],
                         "code": co["code"], "expectedSheet": want_sheet,
                         "actualSheets": sorted({h.get("sheet") for h in hits})}
                    )
            else:
                cj["unmatched"].append(
                    {"name": rec["fullName"], "raw": co["raw"],
                     "nickname": co["nickname"],
                     "priorProvider": co.get("priorProvider", False)}
                )

        client, how = match_client(rec, idx)
        if not client:
            r["onlyInContacts"].append(
                {"name": rec["fullName"], "email": rec["email"],
                 "phone": rec["phone"],
                 "dogs": [d["name"] or f"({d['breed']})" for d in rec["dogs"]],
                 "courses": [c["raw"] for c in rec["courses"]],
                 "services": [s["raw"] for s in rec["oneToOne"]]}
            )
            continue

        r["matchedCount"] += 1
        if how.startswith("email"):
            r["matchedByEmail"] += 1
        else:
            r["matchedByName"] += 1
        matched_client_keys.add(id(client))

        # ---- phone ----
        cd, pd_ = rec["phoneDigits"], digits(client.get("phone"))
        if cd and pd_ and cd != pd_:
            r["fieldConflicts"]["phone"].append(
                {"name": rec["fullName"], "contacts": rec["phone"],
                 "spreadsheet": client.get("phone")}
            )
        elif cd and not pd_:
            r["gapFills"]["phone"].append(
                {"name": rec["fullName"], "contacts": rec["phone"]}
            )

        # ---- address ----
        c_addr = ", ".join(
            x for x in (rec["street"], rec["city"], rec["postcode"]) if x
        ) or (rec["addressHints"][0] if rec["addressHints"] else "")
        s_addr = client.get("address") or ""
        if c_addr and s_addr:
            if not addresses_agree(c_addr, s_addr):
                r["fieldConflicts"]["address"].append(
                    {"name": rec["fullName"], "contacts": c_addr,
                     "spreadsheet": s_addr}
                )
        elif c_addr and not s_addr:
            r["gapFills"]["address"].append(
                {"name": rec["fullName"], "contacts": c_addr}
            )

        # ---- dogs / breeds ----
        p_dogs = prime_dogs_for(rec, client, idx)
        p_names = {(d["dog"] or "").strip() for d in p_dogs if d.get("dog")}
        p_names |= {x for x in (client.get("dogs") or []) if x}
        p_breeds = [d["breed"] for d in p_dogs if d.get("breed")]
        c_names = {d["name"] for d in rec["dogs"] if d.get("name")}
        c_breeds = [d["breed"] for d in rec["dogs"] if d.get("breed")]

        if c_names and p_names:
            lower_p = {x.lower() for x in p_names}
            if not any(n.lower().split(" (")[0] in lower_p or
                       any(n.lower().startswith(p) or p.startswith(n.lower())
                           for p in lower_p)
                       for n in c_names):
                r["fieldConflicts"]["dogName"].append(
                    {"name": rec["fullName"], "contacts": sorted(c_names),
                     "spreadsheet": sorted(p_names)}
                )
        elif c_names and not p_names:
            r["gapFills"]["dogName"].append(
                {"name": rec["fullName"], "contacts": sorted(c_names),
                 "spreadsheetHadBreed": sorted(set(p_breeds))}
            )

        if c_breeds and p_breeds:
            if all(norm_breed(pb) in VAGUE_BREEDS for pb in p_breeds) and any(
                norm_breed(cb) not in VAGUE_BREEDS for cb in c_breeds
            ):
                r["gapFills"]["breed"].append(
                    {"name": rec["fullName"], "contacts": c_breeds,
                     "replaces": sorted(set(p_breeds))}
                )
            elif not any(breeds_agree(cb, pb)
                         for cb in c_breeds for pb in p_breeds):
                r["fieldConflicts"]["breed"].append(
                    {"name": rec["fullName"], "contacts": c_breeds,
                     "spreadsheet": sorted(set(p_breeds))}
                )
        elif c_breeds and not p_breeds:
            r["gapFills"]["breed"].append(
                {"name": rec["fullName"], "contacts": c_breeds}
            )

    # ---- spreadsheet dog-name column holding things that are not names ----
    breed_vocab = build_breed_vocab(prime)
    junk = Counter()
    for en in idx["enrolments"]:
        dog = (en.get("dog") or "").strip()
        if not dog:
            continue
        nb = norm_breed(dog)
        looks_wrong = (
            nb in breed_vocab
            or len(dog.split()) > 2
            or re.search(r"pull|withdraw|cancel|note|please|mixed|tbc|n/a|\?",
                         dog, re.I)
        )
        if looks_wrong:
            junk[dog] += 1
    r["quality"]["junkSpreadsheetDogNames"] = junk.most_common()

    # ---- only in spreadsheet ----
    c_emails = {rec["emailKey"] for rec in records if rec["emailKey"]}
    c_emails |= {rec["email2"] for rec in records if rec["email2"]}
    c_names_all = {rec["nameKey"] for rec in records if rec["nameKey"]}
    for cl in idx["clients"]:
        e, n = norm_email(cl.get("email")), norm_name(cl.get("name"))
        if (e and e in c_emails) or (n and n in c_names_all):
            continue
        r["onlyInSpreadsheet"].append(
            {"name": cl.get("name"), "email": cl.get("email"),
             "phone": cl.get("phone"),
             "dogs": cl.get("dogs") or [],
             "courseIds": cl.get("courseIds") or []}
        )

    # ---- nameless spreadsheet dogs rescued by contacts.csv ----
    nameless_enrol = [e for e in idx["enrolments"] if not e.get("dog")]
    nameless_people = {norm_email(e.get("email")) or norm_name(e.get("name"))
                       for e in nameless_enrol}
    nameless_people.discard("")
    rescued = []
    for rec in records:
        if rec["isBlankRow"]:
            continue
        key = rec["emailKey"] or rec["nameKey"]
        alt = rec["nameKey"]
        if (key in nameless_people or alt in nameless_people) and any(
            d.get("name") for d in rec["dogs"]
        ):
            rescued.append(
                {"name": rec["fullName"],
                 "dogs": [d["name"] for d in rec["dogs"] if d.get("name")],
                 "breeds": [d["breed"] for d in rec["dogs"]]}
            )
    r["namelessDogs"] = {
        "spreadsheetEnrolmentsWithNoDogName": len(nameless_enrol),
        "spreadsheetClientsWithNoDogAtAll": sum(
            1 for c in idx["clients"] if not c.get("dogs")
        ),
        "rescuedByContacts": rescued,
    }

    # ---- cross-file overlap ----
    prof_emails = {norm_email(p.get("Email")) for p in professionals}
    prof_emails.discard("")
    prof_by_email = {}
    for p in professionals:
        e = norm_email(p.get("Email"))
        if e:
            prof_by_email.setdefault(e, []).append(p)
    prime_emails = {norm_email(c.get("email")) for c in idx["clients"]}
    prime_emails.discard("")
    prof_in_contacts = sorted(prof_emails & c_emails)
    prof_in_prime = sorted(prof_emails & prime_emails)

    prof_names = {norm_name(p.get("Name")) for p in professionals} - {""}
    prof_name_in_contacts = sorted(prof_names & c_names_all)

    profile_emails = {norm_email(p.get("Email")) for p in profiles} - {""}
    prof_only_profiles = sorted(profile_emails & prof_emails)
    profiles_in_contacts = profile_emails & c_emails
    profiles_in_prime = profile_emails & prime_emails

    r["overlap"] = {
        "professionalsTotal": len(professionals),
        "professionalsDistinctEmails": len(prof_emails),
        "professionalsInContacts": prof_in_contacts,
        "professionalsInPrime": prof_in_prime,
        "professionalsMatchedByNameOnly": [
            n for n in prof_name_in_contacts
            if not any(norm_email(p.get("Email")) in c_emails
                       for p in professionals if norm_name(p.get("Name")) == n)
        ],
        "professionalDetail": {
            e: prof_by_email[e][0].get("Business") for e in prof_in_contacts
        },
        "profilesTotal": len(profiles),
        "profilesDistinctEmails": len(profile_emails),
        "profilesInContacts": len(profiles_in_contacts),
        "profilesInPrime": len(profiles_in_prime),
        "profilesInNeither": len(profile_emails - c_emails - prime_emails),
        "profilesInBoth": len(profiles_in_contacts & profiles_in_prime),
        "profilesAlsoProfessionals": prof_only_profiles,
        "profilesInContactsSample": sorted(profiles_in_contacts)[:MAX_EXAMPLES],
        "profilesInNeitherSample": sorted(
            profile_emails - c_emails - prime_emails
        )[:MAX_EXAMPLES],
    }
    return r


# --------------------------------------------------------------------------
# Report
# --------------------------------------------------------------------------


def show(v) -> str:
    """Render a value for the report: lists become 'a, b', newlines collapse."""
    if isinstance(v, (list, tuple, set)):
        return ", ".join(show(x) for x in v) or "none"
    s = str(v if v is not None else "")
    return re.sub(r"\s*\n\s*", ", ", s).strip() or "none"


def bullet(items, fmt, limit=MAX_EXAMPLES):
    out = []
    for x in items[:limit]:
        out.append("- " + fmt(x))
    if len(items) > limit:
        out.append(f"- _...and {len(items) - limit} more (full list in the JSON)._")
    return out


def write_report(records, prime, res, profiles, professionals) -> str:
    L: list[str] = []
    a = L.append
    live = [r_ for r_ in records if not r_["isBlankRow"]]

    a("# PRIME PUPS import — conflict report")
    a("")
    a("What this is: a **read-only** comparison of the Outlook contacts export "
      "against the data already pulled out of the PRIME PUPS spreadsheet. "
      "Nothing has been imported or changed. This is the list of decisions "
      "someone needs to make before the import runs.")
    a("")
    a("## What went in")
    a("")
    a(f"- **contacts.csv** — {len(records)} contact rows "
      f"({len(live)} with something in them)")
    a(f"- **prime_extracted.json** — {len(prime.get('clients', []))} people, "
      f"{len(prime.get('enrolments', []))} class sign-ups, "
      f"{len(prime.get('courses', []))} classes, "
      f"{len(prime.get('waitlist', []))} on the waitlist")
    a(f"- **profiles.csv** — {len(profiles)} website subscribers")
    a(f"- **professionals.csv** — {len(professionals)} pet-industry professionals")
    a("")
    a(f"Of the {len(live)} contacts, **{res['matchedCount']} were found** in the "
      f"spreadsheet ({res['matchedByEmail']} matched on email address, "
      f"{res['matchedByName']} on name only).")
    a("")

    # 1
    fc = res["fieldConflicts"]
    total_fc = sum(len(v) for v in fc.values())
    a("---")
    a("")
    a(f"## 1. Field conflicts — the two sources disagree ({total_fc})")
    a("")
    a("Same person, but the contacts file and the spreadsheet say different "
      "things. Someone has to pick a winner.")
    a("")
    for key, label in (("phone", "Different phone number"),
                       ("address", "Different address"),
                       ("dogName", "Different dog name"),
                       ("breed", "Different breed")):
        items = fc[key]
        a(f"### {label} — {len(items)}")
        a("")
        if not items:
            a("_None._")
        else:
            L.extend(bullet(
                items,
                lambda x: f"**{x['name']}** — contacts: `{show(x['contacts'])}` "
                          f"· spreadsheet: `{show(x['spreadsheet'])}`"))
        a("")

    # 2
    gf = res["gapFills"]
    total_gf = sum(len(v) for v in gf.values())
    a("---")
    a("")
    a(f"## 2. Fills a gap — contacts.csv has something the spreadsheet lacks "
      f"({total_gf})")
    a("")
    a("Free wins. No conflict, just information the spreadsheet never had.")
    a("")
    for key, label in (("phone", "Phone number the spreadsheet was missing"),
                       ("address", "Address the spreadsheet was missing"),
                       ("dogName", "Dog name the spreadsheet was missing"),
                       ("breed", "Breed the spreadsheet was missing")):
        items = gf[key]
        a(f"### {label} — {len(items)}")
        a("")
        if not items:
            a("_None._")
        else:
            L.extend(bullet(
                items,
                lambda x: f"**{x['name']}** — `{show(x['contacts'])}`"
                          + (f" (replaces the vague `{show(x['replaces'])}`)"
                             if x.get("replaces") else "")))
        a("")

    nd = res["namelessDogs"]
    a("### Dogs with no name in the spreadsheet")
    a("")
    a("The spreadsheet has no dog literally called \"Puppy\" — instead the dog "
      "name is simply **blank**, which is what would end up as a placeholder "
      "on import.")
    a("")
    a(f"- **{nd['spreadsheetEnrolmentsWithNoDogName']}** class sign-ups have "
      f"no dog name at all")
    a(f"- **{nd['spreadsheetClientsWithNoDogAtAll']}** people in the "
      f"spreadsheet have no dog recorded anywhere")
    a(f"- **{len(nd['rescuedByContacts'])}** of those people have a real dog "
      f"name waiting in contacts.csv")
    a("")
    L.extend(bullet(
        nd["rescuedByContacts"],
        lambda x: f"**{x['name']}** — gets `{show(x['dogs'])}` "
                  f"({show(x['breeds'])})"))
    a("")

    # 3
    a("---")
    a("")
    a(f"## 3. Only in contacts.csv — not in the spreadsheet at all "
      f"({len(res['onlyInContacts'])})")
    a("")
    a("These people would be brand-new records.")
    a("")
    L.extend(bullet(
        res["onlyInContacts"],
        lambda x: f"**{x['name']}** ({x['email'] or 'no email'}) — "
                  f"dogs: {show(x['dogs'])}; classes: {show(x['courses'])}"
                  + (f"; services: {show(x['services'])}" if x['services'] else "")))
    a("")

    # 4
    a("---")
    a("")
    a(f"## 4. Only in the spreadsheet — missing from contacts.csv "
      f"({len(res['onlyInSpreadsheet'])})")
    a("")
    a("These already exist in the spreadsheet extraction and get no extra "
      "detail from the contacts file.")
    a("")
    L.extend(bullet(
        res["onlyInSpreadsheet"],
        lambda x: f"**{x['name']}** ({x['email'] or 'no email'}) — "
                  f"dogs: {show(x['dogs'])}; {len(x['courseIds'])} class(es)"))
    a("")

    # 5
    cj = res["courseJoin"]
    a("---")
    a("")
    a(f"## 5. Class references — do they line up? ({cj['total']} references)")
    a("")
    a(f"- **{cj['matched']}** class references match a class in the spreadsheet "
      f"({cj['matchedExact']} matched the nickname outright, "
      f"{len(cj['matchedFuzzy'])} only after allowing for spelling and "
      f"punctuation differences)")
    a(f"- **{len(cj['unmatched'])}** name a class the spreadsheet does not have")
    a(f"- **{len(cj['noNickname'])}** are cut off or never had a nickname "
      f"(e.g. `SP March 2026 -`)")
    a(f"- **{len(cj['codeMismatch'])}** match a nickname but the class *type* "
      f"disagrees (e.g. tagged SP but the spreadsheet files it under Early "
      f"Learning)")
    a(f"- **{len(cj['priorProvider'])}** refer to classes run by a *previous "
      f"trainer* (Allsorts / ADT / Journey) — these can never match, and "
      f"probably should not be imported as PRIME PUPS class history")
    a(f"- **{len(cj['didNotAttend'])}** say the person signed up but did not "
      f"attend")
    a("")
    a("### Class references with no match in the spreadsheet")
    a("")
    unmatched_counter = Counter(x["raw"] for x in cj["unmatched"])
    L.extend(bullet(
        unmatched_counter.most_common(),
        lambda x: f"`{x[0]}` — {x[1]} person(s)", limit=40))
    a("")
    a("### Cut-off / nickname-less references")
    a("")
    nn = Counter(x["raw"] for x in cj["noNickname"])
    L.extend(bullet(nn.most_common(),
                    lambda x: f"`{x[0]}` — {x[1]} person(s)", limit=40))
    a("")
    if cj["matchedFuzzy"]:
        a("### Matched, but only after cleaning up the spelling")
        a("")
        a("These joined successfully. Listed so someone can spot-check that the "
          "match is genuinely the same class.")
        a("")
        fz = Counter(
            (x["contactsNickname"], x["spreadsheetNickname"], x["how"])
            for x in cj["matchedFuzzy"]
        )
        L.extend(bullet(
            fz.most_common(),
            lambda x: f"`{x[0][0]}` → `{x[0][1]}` ({x[0][2]}) — {x[1]} time(s)",
            limit=30))
        a("")
    if cj["priorProvider"]:
        a("### Classes run by a previous trainer")
        a("")
        L.extend(bullet(
            Counter(x["raw"] for x in cj["priorProvider"]).most_common(),
            lambda x: f"`{x[0]}` — {x[1]} person(s)", limit=25))
        a("")
    if cj["didNotAttend"]:
        a("### Signed up but did not attend")
        a("")
        L.extend(bullet(
            cj["didNotAttend"],
            lambda x: f"**{x['name']}** — `{x['raw']}`", limit=15))
        a("")
    if cj["codeMismatch"]:
        a("### Class type disagrees with the spreadsheet")
        a("")
        L.extend(bullet(
            cj["codeMismatch"],
            lambda x: f"**{x['name']}** — `{x['raw']}` says {x['code']} "
                      f"({x['expectedSheet']}) but the spreadsheet has it under "
                      f"{', '.join(x['actualSheets'])}"))
        a("")

    # 6
    a("---")
    a("")
    ns = res["newServices"]
    a(f"## 6. One-to-one / in-home services — not in the spreadsheet at all "
      f"({sum(ns.values())} references)")
    a("")
    a("The spreadsheet only covers group classes. Every reference below is "
      "history that exists nowhere else.")
    a("")
    a("| Code | What it looks like | References |")
    a("|---|---|---|")
    meaning = {
        "DTP": "Dog training package / programme",
        "DTS": "Dog training session",
        "PFP": "Puppy foundation package",
        "PFS": "Puppy foundation session",
        "TW": "Training walks",
        "ADT": "Prior trainer (Allsorts Dog Training)",
        "OC": "Owed / credit class sessions",
        "IN-HOME": "In-home or 1:1 visit (no code given)",
    }
    for code, n in ns.most_common():
        a(f"| **{code}** | {meaning.get(code, '—')} | {n} |")
    a("")
    for code, n in ns.most_common():
        a(f"### {code} ({n})")
        a("")
        L.extend(bullet(
            res["newServiceExamples"][code],
            lambda x: f"**{x['name']}** — `{x['raw']}`", limit=8))
        a("")

    # 7
    a("---")
    a("")
    a(f"## 7. Interns, volunteers and placements ({len(res['roles'])})")
    a("")
    a("These are not clients. They should probably not be imported as clients.")
    a("")
    L.extend(bullet(res["roles"],
                    lambda x: f"**{x['name']}** ({x['email'] or 'no email'}) — "
                              f"`{x['raw']}`", limit=40))
    a("")

    # 8
    q = res["quality"]
    a("---")
    a("")
    a("## 8. Data quality problems")
    a("")
    a(f"### The same email address appears more than once "
      f"({len(q['duplicateEmails'])})")
    a("")
    a("Each of these is two contact rows for one person — they must be merged, "
      "not imported twice.")
    a("")
    L.extend(bullet(
        q["duplicateEmails"],
        lambda x: f"`{x['email']}` — {x['count']} rows "
                  f"({show(x['names'])}, rows {show(x['rows'])})", limit=40))
    a("")
    a(f"### Completely blank rows ({len(q['blankRows'])})")
    a("")
    a("_Rows: " + (", ".join(str(x) for x in q["blankRows"]) or "none") + "_")
    a("")
    a(f"### Rows with no email address ({len(q['noEmail'])})")
    a("")
    a("Without an email there is nothing reliable to match on, so these risk "
      "creating duplicates.")
    a("")
    L.extend(bullet(
        q["noEmail"],
        lambda x: f"row {x['row']} — **{x['name'] or '(no name)'}**, "
                  f"phone `{x['phone'] or 'none'}`", limit=30))
    a("")
    a(f"### Suspicious phone numbers ({len(q['badPhones'])})")
    a("")
    L.extend(bullet(
        q["badPhones"],
        lambda x: f"**{x['name']}** — `{x['phone']}` ({x['reason']})", limit=30))
    a("")
    a(f"### Placeholder dog names in contacts.csv "
      f"({len(q['placeholderDogNames'])})")
    a("")
    a("The dog's name is literally 'TBC' or similar — it should not be "
      "imported as the dog's actual name.")
    a("")
    L.extend(bullet(
        q["placeholderDogNames"],
        lambda x: f"**{x['name']}** — dog recorded as `{x['dogName']}` "
                  f"({x['breed']})", limit=20))
    a("")
    a(f"### The spreadsheet's dog-name column holding things that are not "
      f"names ({len(q['junkSpreadsheetDogNames'])} distinct values)")
    a("")
    a("This is a problem on the *spreadsheet* side, not the contacts side — "
      "someone has typed a breed, a status or a note where the dog's name "
      "should be.")
    a("")
    L.extend(bullet(
        q["junkSpreadsheetDogNames"],
        lambda x: f"`{x[0]}` — {x[1]} time(s)", limit=25))
    a("")
    a(f"### Dogs recorded as having died ({len(res['deceasedDogs'])})")
    a("")
    a("Flagged so nobody sends these owners a class invitation.")
    a("")
    L.extend(bullet(res["deceasedDogs"],
                    lambda x: f"**{x['name']}** — {x['dog']}: `{x['raw']}`",
                    limit=15))
    a("")
    a(f"### Notes lines the parser could not classify "
      f"({sum(q['unclassified'].values())} lines, "
      f"{len(q['unclassified'])} distinct)")
    a("")
    a("Nothing is lost — every one of these is kept verbatim in the "
      "`freeText` field of the JSON. They are listed so a human can decide "
      "whether any of them mean something.")
    a("")
    L.extend(bullet(
        q["unclassified"].most_common(),
        lambda x: f"`{x[0]}` — {x[1]}× "
                  f"(e.g. {', '.join(q['unclassifiedExamples'][x[0]])})", limit=45))
    a("")

    # 9
    o = res["overlap"]
    a("---")
    a("")
    a("## 9. Overlap between the four files")
    a("")
    a("### Professionals who are also clients")
    a("")
    a(f"- **{len(o['professionalsInContacts'])}** of the "
      f"{o['professionalsDistinctEmails']} professional email addresses also "
      f"appear in contacts.csv")
    a(f"- **{len(o['professionalsInPrime'])}** appear in the spreadsheet")
    a("")
    for e in o["professionalsInContacts"][:MAX_EXAMPLES]:
        a(f"- `{e}` — {o['professionalDetail'].get(e, '')}")
    if o["professionalsMatchedByNameOnly"]:
        a("")
        a("Matched by **name only** (different email in each file — check "
          "these by hand):")
        for n in o["professionalsMatchedByNameOnly"][:MAX_EXAMPLES]:
            a(f"- {n.title()}")
    a("")
    a("### Website subscribers (profiles.csv)")
    a("")
    a(f"- **{o['profilesInContacts']}** of {o['profilesDistinctEmails']} "
      f"subscriber emails are already in contacts.csv")
    a(f"- **{o['profilesInPrime']}** are already in the spreadsheet")
    a(f"- **{o['profilesInBoth']}** are in both")
    a(f"- **{o['profilesInNeither']}** are in neither — subscribers who have "
      f"never taken a class")
    a(f"- **{len(o['profilesAlsoProfessionals'])}** are also on the "
      f"professionals list")
    a("")
    a("Examples of subscribers who appear nowhere else:")
    a("")
    for e in o["profilesInNeitherSample"]:
        a(f"- `{e}`")
    a("")

    a("---")
    a("")
    a("## Extra things found along the way")
    a("")
    a(f"### Money held in credit or owed ({len(res['credits'])})")
    a("")
    a("These notes record real money. The spreadsheet extraction has no "
      "concept of a credit balance, so this would be lost on import.")
    a("")
    L.extend(bullet(res["credits"],
                    lambda x: f"**{x['name']}** — `{x['raw']}`", limit=25))
    a("")
    a(f"### Door / lockbox / gate codes ({res['accessCodes']})")
    a("")
    a("Access codes for in-home visits, mixed in with the notes. They are "
      "kept in the `accessCodes` field of the JSON rather than dumped into a "
      "general notes box, because they are sensitive.")
    a("")

    a("---")
    a("")
    a("## Decisions a human needs to make")
    a("")
    a("1. When the two sources disagree on a **phone or address**, which one "
       "wins? (Section 1.)")
    a("2. The **cut-off class references** (section 5) cannot be joined "
       "automatically — either fix them in Outlook or accept the loss.")
    a("3. The **one-to-one services** (section 6) have no home in the current "
       "import. Decide whether to build one before importing, or drop the "
       "history.")
    a("4. **Interns and volunteers** (section 7) should probably not become "
       "client records.")
    a("5. The **duplicate email rows** (section 8) must be merged first.")
    a("6. **Professionals who are also clients** (section 9) will otherwise "
       "become two records for one human.")
    a("")
    return "\n".join(L)


# --------------------------------------------------------------------------


def main() -> int:
    for p in (CONTACTS_CSV, PRIME_JSON, PROFILES_CSV, PROFESSIONALS_CSV):
        if not p.exists():
            print(f"missing input: {p}", file=sys.stderr)
            return 1

    prime = json.loads(PRIME_JSON.read_text(encoding="utf-8"))
    records = parse_contacts(prime)
    profiles = load_simple_csv(PROFILES_CSV)
    professionals = load_simple_csv(PROFESSIONALS_CSV)

    res = analyse(records, prime, profiles, professionals)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(
        json.dumps(
            {
                "meta": {
                    "contactRows": len(records),
                    "primeClients": len(prime.get("clients", [])),
                    "primeEnrolments": len(prime.get("enrolments", [])),
                    "primeCourses": len(prime.get("courses", [])),
                    "profiles": len(profiles),
                    "professionals": len(professionals),
                },
                "contacts": records,
            },
            indent=1,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    OUT_MD.write_text(
        write_report(records, prime, res, profiles, professionals),
        encoding="utf-8",
    )

    # Console summary
    fc = res["fieldConflicts"]
    gf = res["gapFills"]
    print(f"contacts rows            : {len(records)}")
    print(f"matched to spreadsheet   : {res['matchedCount']} "
          f"(email {res['matchedByEmail']}, name {res['matchedByName']})")
    print(f"1 field conflicts        : {sum(len(v) for v in fc.values())} "
          f"({ {k: len(v) for k, v in fc.items()} })")
    print(f"2 gap fills              : {sum(len(v) for v in gf.values())} "
          f"({ {k: len(v) for k, v in gf.items()} })")
    print(f"3 only in contacts       : {len(res['onlyInContacts'])}")
    print(f"4 only in spreadsheet    : {len(res['onlyInSpreadsheet'])}")
    cj = res["courseJoin"]
    print(f"5 course refs            : {cj['total']} "
          f"(matched {cj['matched']} [exact {cj['matchedExact']}, "
          f"fuzzy {len(cj['matchedFuzzy'])}], "
          f"unmatched {len(cj['unmatched'])}, "
          f"no nickname {len(cj['noNickname'])}, "
          f"code mismatch {len(cj['codeMismatch'])}, "
          f"prior trainer {len(cj['priorProvider'])}, "
          f"did-not-attend {len(cj['didNotAttend'])})")
    print(f"  credits {len(res['credits'])}, access codes {res['accessCodes']}")
    print(f"6 1:1 service refs       : {sum(res['newServices'].values())} "
          f"{dict(res['newServices'])}")
    print(f"7 roles                  : {len(res['roles'])}")
    q = res["quality"]
    print(f"8 dup emails {len(q['duplicateEmails'])}, blank {len(q['blankRows'])}, "
          f"no-email {len(q['noEmail'])}, bad phones {len(q['badPhones'])}, "
          f"unclassified lines {sum(q['unclassified'].values())}")
    o = res["overlap"]
    print(f"9 professionals in contacts {len(o['professionalsInContacts'])}, "
          f"in prime {len(o['professionalsInPrime'])}; "
          f"profiles in contacts {o['profilesInContacts']}, "
          f"in prime {o['profilesInPrime']}, "
          f"neither {o['profilesInNeither']}")
    print(f"nameless spreadsheet dogs: "
          f"{res['namelessDogs']['spreadsheetEnrolmentsWithNoDogName']} sign-ups, "
          f"{len(res['namelessDogs']['rescuedByContacts'])} rescued by contacts")
    print(f"\nwrote {OUT_JSON}\nwrote {OUT_MD}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
