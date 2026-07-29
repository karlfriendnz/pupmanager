"""
Text normalisation — the layer everything else stands on.

WHY THIS EXISTS
---------------
Client data arrives written by humans, in a hurry, over years. The same phone
number appears as "021 130 6127", "+6421130612 7" and 211306127. The same
street is "Sagewood Road" and "Sagewood Rd". The same class is "The Fox
Terrier's" and "the fox terriers". The same breed is "Staffy" and
"Staffordshire Bull Terrier".

None of that is an error the client should be asked about — it is one fact
spelled two ways. If we compare raw strings we manufacture hundreds of fake
"conflicts" and bury the dozen real ones, and the review workbook becomes
unreadable, which means nobody reads it, which means the import goes in blind.

So every comparison in this toolkit goes through a *normalising key* first,
and every "do these agree?" question is a named function here rather than an
inline `==` somewhere. When a new client turns out to write something a new
way, there is exactly one place to teach it.

The functions are deliberately pure and dependency-free (no config objects
required for the common path) so they can be unit-tested and reused from a
source module, the merge engine, or an ad-hoc console session.

REGIONAL DEFAULTS
-----------------
Phone shapes and road-type words default to New Zealand because that is where
the first clients are. Both are passed as data (`PhoneRules`, `ROAD_TYPES`) so
another region is a config change, not a fork.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

# ---------------------------------------------------------------------------
# Basic keys
# ---------------------------------------------------------------------------

MACRONS = str.maketrans("āēīōūĀĒĪŌŪ", "aeiouAEIOU")

MONTHS = (
    "January February March April May June July August September October "
    "November December"
).split()
MONTH_RE = "|".join(MONTHS) + "|" + "|".join(m[:3] for m in MONTHS)
MONTH_NUM = {m.lower()[:3]: i for i, m in enumerate(MONTHS, start=1)}


def clean(v) -> str:
    """Any cell value -> a trimmed string. None and NaN-ish values become ''."""
    if v is None:
        return ""
    if isinstance(v, str):
        return v.strip()
    return str(v).strip()


def norm_email(v: str | None) -> str:
    return (v or "").strip().lower()


def norm_name(v: str | None) -> str:
    """Lowercase, punctuation-free, single-spaced — the person-matching key."""
    s = (v or "").lower()
    s = s.replace("&", " and ")
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def norm_nickname(v: str | None) -> str:
    """
    Class-nickname key. Case-insensitive, apostrophes stripped, a leading
    "the" dropped and a trailing plural "s" removed, so

        "The Fox Terrier's" == "The Fox Terriers" == "the fox terrier"

    are one class. Classes get nicknamed by whoever typed the row, and the
    same intake is referred to three different ways across two files.
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


def name_tokens(v: str) -> set[str]:
    return {t for t in norm_name(v).split() if t and t != "and"}


def split_name(full: str) -> tuple[str, str]:
    """"Sara Elliott-Warren" -> ("Sara", "Elliott-Warren"). Never guesses."""
    parts = clean(full).split()
    if not parts:
        return "", ""
    if len(parts) == 1:
        return parts[0], ""
    return parts[0], " ".join(parts[1:])


def month_num(m: str | None) -> int:
    if not m:
        return 0
    return MONTH_NUM.get(m.strip().lower()[:3], 0)


def month_year(text: str) -> tuple[str | None, str | None]:
    """Pull a month name and a 4-digit year out of free text."""
    m = re.search(r"(" + MONTH_RE + r")[a-z]*", text, re.I)
    y = re.search(r"(20\d{2})", text)
    month = None
    if m:
        stem = m.group(1).lower()[:3]
        month = next((x for x in MONTHS if x.lower().startswith(stem)), None)
    return month, (y.group(1) if y else None)


# ---------------------------------------------------------------------------
# Fuzzy matching
# ---------------------------------------------------------------------------

def edit_distance_le1(a: str, b: str) -> bool:
    """
    True when a and b differ by at most one insert / delete / substitution.

    Capped at one on purpose. Two edits starts merging genuinely different
    people ("Ryan Black" / "Bryan Black"), and a wrong merge is far more
    expensive to unpick after import than a duplicate is to spot before it.
    """
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


def names_compatible(a: str, b: str) -> bool:
    """
    True when one name is the same as, or contained in, the other — allowing
    a one-letter difference per word.

    "Sara Elliott-Warren" and "Sara Elliot-Warren" are one person.
    "Ryan Black" and "Annie Black" stay two. That second case is real: two
    professionals shared one email address, and merging them would have
    silently deleted a business.
    """
    ta, tb = name_tokens(a), name_tokens(b)
    if not ta or not tb:
        return False
    if ta == tb or ta <= tb or tb <= ta:
        return True

    def covered(small: set[str], big: set[str]) -> bool:
        return all(
            t in big or any(len(t) > 3 and edit_distance_le1(t, u) for u in big)
            for t in small
        )

    return covered(ta, tb) or covered(tb, ta)


def resolve_nickname(key: str, known_keys) -> tuple[str | None, str]:
    """
    Match a class nickname against the nicknames we already know.

    Returns (matched_key, how) where how is exact / prefix / tokens / spelling,
    so the review workbook can show WHY two differently-spelled classes were
    treated as one. A fuzzy match that nobody can see is a fuzzy match nobody
    can veto.
    """
    if not key:
        return None, ""
    if key in known_keys:
        return key, "exact"
    kt = set(key.split())
    for pk in known_keys:
        if len(key) >= 4 and len(pk) >= 4 and (key.startswith(pk) or pk.startswith(key)):
            return pk, "prefix"
    for pk in known_keys:
        pt = set(pk.split())
        if kt and pt and (kt <= pt or pt <= kt):
            return pk, "tokens"
    for pk in known_keys:
        if len(key) >= 5 and edit_distance_le1(key, pk):
            return pk, "spelling"
    return None, ""


# ---------------------------------------------------------------------------
# Phones
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class PhoneRules:
    """
    How this client's country writes a phone number.

    `country_code` is folded back to `trunk_prefix` so +64 21 …, 0064 21 … and
    021 … produce one comparison key. Length bounds catch a number that lost a
    digit to a spreadsheet's number formatting — worth flagging, never worth
    silently discarding.
    """
    country_code: str = "64"
    trunk_prefix: str = "0"
    mobile_prefixes: tuple[str, ...] = ("2",)
    landline_prefixes: tuple[str, ...] = ("3", "4", "6", "7", "9")
    mobile_len: tuple[int, int] = (9, 11)
    landline_len: tuple[int, int] = (9, 10)


NZ_PHONE = PhoneRules()


def digits(v: str | None, rules: PhoneRules = NZ_PHONE) -> str:
    """Phone comparison key: digits only, international prefixes folded back."""
    s = re.sub(r"[^\d+]", "", (v or ""))
    cc = rules.country_code
    s = re.sub(r"^\+?" + cc, rules.trunk_prefix, s)
    s = re.sub(r"^00", rules.trunk_prefix, s)
    s = re.sub(r"\D", "", s)
    # A number written as 64211234567 with no plus sign.
    if len(s) > 10 and s.startswith(cc):
        s = rules.trunk_prefix + s[len(cc):]
    return s


def plausible_phone(raw: str | None, rules: PhoneRules = NZ_PHONE) -> tuple[bool, str]:
    """(ok, human reason). An implausible number is reported, never dropped."""
    d = digits(raw, rules)
    if not d:
        return True, ""
    tp = rules.trunk_prefix
    if not d.startswith(tp):
        return False, f"does not start with {tp} (or +{rules.country_code})"
    rest = d[len(tp):]
    if not rest:
        return False, "no digits after the trunk prefix"
    head = rest[0]
    if head in rules.mobile_prefixes:
        lo, hi = rules.mobile_len
        if not (lo <= len(d) <= hi):
            return False, f"mobile has {len(d)} digits (expected {lo}-{hi})"
        return True, ""
    if head in rules.landline_prefixes:
        lo, hi = rules.landline_len
        if not (lo <= len(d) <= hi):
            return False, f"landline has {len(d)} digits (expected {lo}-{hi})"
        return True, ""
    return False, f"unrecognised prefix {tp}{head}"


# ---------------------------------------------------------------------------
# Addresses
# ---------------------------------------------------------------------------

ROAD_WORDS = {
    "road": "rd", "rd": "rd", "street": "st", "st": "st", "avenue": "ave",
    "ave": "ave", "place": "pl", "pl": "pl", "drive": "dr", "dr": "dr",
    "crescent": "cres", "cres": "cres",
}
ROAD_TYPES = {
    "rd", "st", "ave", "pl", "dr", "cres", "cresent", "lane", "way", "terrace",
    "grove", "close", "court", "boulevard", "parade", "track", "dell", "avenue",
}


def norm_street(v: str | None) -> str:
    """First address line, lowercased, road-type words abbreviated."""
    s = (v or "").translate(MACRONS)
    s = s.replace("\r", "\n").split("\n")[0]
    s = s.split(",")[0]
    s = s.lower()
    for long, short in ROAD_WORDS.items():
        s = re.sub(r"\b" + long + r"\b", short, s)
    s = re.sub(r"[^a-z0-9 ]+", "", s)
    return re.sub(r"\s+", " ", s).strip()


def street_key(v: str | None) -> tuple[str, str]:
    """(house number, street name with its road-type word removed)."""
    s = norm_street(v)
    if not s:
        return "", ""
    toks = s.split()
    num = toks[0] if toks and re.match(r"^\d", toks[0]) else ""
    words = [t for t in toks[1:]
             if t not in ROAD_TYPES and not re.fullmatch(r"rd\d*|\d+", t)]
    return num, " ".join(words[:2])


def addresses_agree(a: str | None, b: str | None) -> bool:
    """
    Same address? Tolerates "Road" vs "Rd", a rural "RD 8 Tauranga" suffix, a
    suburb where the other has a city, and one typo in the street name — but
    NEVER a different house number or a different street. Getting that wrong
    posts someone else's paperwork to the wrong house.
    """
    x, y = norm_street(a), norm_street(b)
    if not x or not y:
        return True
    if x == y or x in y or y in x:
        return True
    nx, sx = street_key(a)
    ny, sy = street_key(b)
    if not sx or not sy:
        return False
    if nx != ny:
        return False
    return sx == sy or sx in sy or sy in sx or edit_distance_le1(sx, sy)


# ---------------------------------------------------------------------------
# Breeds
# ---------------------------------------------------------------------------

DEFAULT_BREED_ALIASES = {
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

# Values that say nothing. Treated as MISSING rather than as a disagreement,
# so a real breed from another file fills the gap instead of starting a fight.
VAGUE_BREEDS = {
    "mixed", "mixed breed", "mix", "unknown", "x", "crossbreed", "cross breed",
    "rescue", "rescue dog", "dog", "puppy", "pup", "tbc", "n a",
}


def norm_breed(v: str | None, aliases: dict[str, str] | None = None) -> str:
    aliases = DEFAULT_BREED_ALIASES if aliases is None else aliases
    s = (v or "").lower()
    s = re.sub(r"\(.*?\)", " ", s)
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    words = [aliases.get(w, w) for w in s.split()]
    return re.sub(r"\s+", " ", " ".join(words)).strip()


def breeds_agree(a: str, b: str, aliases: dict[str, str] | None = None) -> bool:
    x, y = norm_breed(a, aliases), norm_breed(b, aliases)
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
    # One-word typo tolerance; "Dogg" vs "Bulldog" stays a real disagreement.
    return any(edit_distance_le1(p, q) and len(p) > 4 for p in xs for q in ys)


# ---------------------------------------------------------------------------
# Dates
# ---------------------------------------------------------------------------

DMY_RE = re.compile(r"(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})")


def parse_dmy(text: str | None) -> str | None:
    """
    "PTS 21/07/25" -> "2025-07-21". Returns None rather than guessing when the
    numbers cannot be a date — a wrong death date is worse than no date.

    Day-first because every client so far is NZ/AU/UK. A US client needs a
    config flag here, not a new function.
    """
    if not text:
        return None
    m = DMY_RE.search(text)
    if not m:
        return None
    d, mo, y = (int(x) for x in m.groups())
    if y < 100:
        y += 2000
    if not (1 <= d <= 31 and 1 <= mo <= 12):
        return None
    return f"{y:04d}-{mo:02d}-{d:02d}"


# ---------------------------------------------------------------------------
# Agreement, by field
# ---------------------------------------------------------------------------

def values_agree(field_name: str, a: str, b: str,
                 rules: PhoneRules = NZ_PHONE) -> bool:
    """
    Are two values for the same field the same thing said differently?

    An empty value never disagrees with anything — it is a gap to fill, not a
    conflict to adjudicate. That single rule is what keeps the conflict list
    down to things a human genuinely has to decide.
    """
    if not a or not b:
        return True
    if field_name == "phone":
        da, db = digits(a, rules), digits(b, rules)
        return da == db or da.endswith(db) or db.endswith(da)
    if field_name == "email":
        return norm_email(a) == norm_email(b)
    if field_name == "address":
        return addresses_agree(a, b)
    if field_name in ("name", "firstName", "lastName", "city"):
        return norm_name(a) == norm_name(b)
    return a.strip().lower() == b.strip().lower()
