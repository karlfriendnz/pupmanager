"""
Content-based cell classification — decide what a value IS, not where it sat.

WHY THIS EXISTS
---------------
The first client's intake spreadsheet had three sheets with three different
column orders, and one of them *changed order half way down* — around row 142
the trainer inserted Puppy Name / Breed / VAXX columns and kept typing. Any
importer that reads "column D is the phone number" produces confident garbage
for the second half of the file and nobody notices until a client gets a text
message meant for someone else.

So we never trust position. Every cell is asked what it looks like, and the
first classifier that claims it wins. Column A is the only positional
assumption we allow, and only because it is the row's subject (the person's
name) in every intake sheet anyone has ever sent us.

ORDER IS THE WHOLE ALGORITHM
----------------------------
    email -> date -> phone -> age -> breed -> address -> dog name

* email before everything, because an address contains digits and words that
  every later test would happily claim.
* **date before phone** — this is the one that bites. "13/12/24" and
  "0211306127" are both digit-and-separator soup; test phone first and every
  booking date in the file becomes somebody's mobile number.
* age before breed, because "12 weeks" has no breed word but "12 week old
  Labrador" does and should be read as a breed with an age note.
* dog name LAST, because it is the loosest test (a short alphabetic token) and
  would otherwise swallow half the sheet.

Anything no classifier claims is kept verbatim as `colX:<value>` in the row's
notes. Nothing is dropped on the floor — see `lib/plan_schema.py`.
"""

from __future__ import annotations

import datetime
import re

from .text import PhoneRules, NZ_PHONE, digits

# ---------------------------------------------------------------------------
# Patterns
# ---------------------------------------------------------------------------

EMAIL_RE = re.compile(r"[\w.+'-]+@[\w-]+\.[\w.-]+")

# A bare dd/mm or dd/mm/yy cell. Deliberately anchored: a date inside a
# sentence is a note, not the row's booking date.
DATE_STR_RE = re.compile(r"^\s*\d{1,2}[/.]\d{1,2}([/.]\d{2,4})?\s*$")

PHONE_SHAPE_RE = re.compile(r"^[\s+]*\(?0?\d[\d\s/()+-]{6,}$")

AGE_RE = re.compile(
    r"\b(week|weeks|wk|wks|month|months|mth|mths|yr|yrs|year|years)\b", re.I)

DEFAULT_STREET_RE = re.compile(
    r"\b(road|rd|street|st|ave|avenue|drive|dr|place|pl|crescent|cres|lane|"
    r"terrace|tce|court|ct|way|grove|blvd|boulevard|close|dell|vista|"
    r"heights|key|mews|parade|highway|rise)\b", re.I)

CROSS_RE = re.compile(r"\bx\b", re.I)

# Values that occupy a dog-name column but are admin flags, not names.
DOG_STOP = {
    "tbc", "?", "volunteer", "unknown", "yes", "no", "y", "n", "paid",
    "credit", "na", "none", "nil", "full", "ok", "reminder", "intern",
    "yes + faqs", "yes + faq's",
}
DOG_REJECT_RE = re.compile(
    r"(paid|faq|reminder|itinerary|emailed|welcome|\$|r\.s|to pay|switch|"
    r"missing|miss )", re.I)


# ---------------------------------------------------------------------------
# Individual tests
# ---------------------------------------------------------------------------

def is_datetime(v) -> bool:
    return isinstance(v, (datetime.datetime, datetime.date))


def fmt_date(v) -> str:
    if is_datetime(v):
        return v.strftime("%Y-%m-%d")
    return str(v).strip()


def find_email(v) -> str | None:
    """
    A real address, or None.

    Not "contains @": intake sheets are full of "12 weeks @ 05/09" where @
    means "as at". Treating those as emails invents contact details.
    """
    if not isinstance(v, str):
        return None
    m = EMAIL_RE.search(v)
    return m.group(0) if m else None


def looks_like_email(v) -> bool:
    return find_email(v) is not None


def looks_like_date(v) -> bool:
    if is_datetime(v):
        return True
    return isinstance(v, str) and bool(DATE_STR_RE.match(v))


def looks_like_phone(v, rules: PhoneRules = NZ_PHONE) -> bool:
    """Only ever called AFTER the date test has failed. See module docstring."""
    if is_datetime(v):
        return False
    if isinstance(v, (int, float)):
        # A spreadsheet that stored the number as a number. Excluding small
        # integers keeps a bare year (2024) from becoming a phone number.
        return int(v) >= 10_000_000
    if not isinstance(v, str):
        return False
    s = v.strip()
    if "@" in s or not PHONE_SHAPE_RE.match(s):
        return False
    return 7 <= len(re.sub(r"\D", "", s)) <= 12


def looks_like_age(v) -> bool:
    if not isinstance(v, str) or "@" in v:
        return False
    return bool(AGE_RE.search(v)) and (bool(re.search(r"\d", v))
                                       or "unknown" in v.lower())


def looks_like_address(v, suburbs: set[str] | None = None,
                       street_re: re.Pattern = DEFAULT_STREET_RE) -> bool:
    """
    A street line, or a bare suburb we have seen elsewhere in this client's
    data. The suburb list is learned from the files, not hardcoded — a new
    town needs no code change.
    """
    if not isinstance(v, str):
        return False
    s = v.strip()
    if "@" in s or len(s) < 5:
        return False
    if street_re.search(s) and re.search(r"\d", s):
        return True
    low = s.lower()
    if suburbs and any(sub in low for sub in suburbs) and len(s) > 6:
        return True
    return False


def looks_like_breed(v, breed_re: re.Pattern | None) -> bool:
    if not isinstance(v, str):
        return False
    s = v.strip()
    if "@" in s:
        return False
    if breed_re is not None and breed_re.search(s):
        return True
    # A bare cross marker: "Lab X", "Foxy X Staffy".
    return bool(CROSS_RE.search(s)) and len(s) <= 40 and bool(re.search(r"[A-Za-z]", s))


def looks_like_dog_name(v) -> bool:
    """Short, mostly-alphabetic, at most three words, not an admin flag."""
    if not isinstance(v, str):
        return False
    s = v.strip()
    if "@" in s or not s or len(s) > 25:
        return False
    if s.lower() in DOG_STOP or DOG_REJECT_RE.search(s):
        return False
    if len(s.split()) > 3:
        return False
    if not any(c.isalpha() for c in s):
        return False
    return sum(c.isalpha() or c in " ()'/-." for c in s) / len(s) > 0.7


def build_breed_re(breed_words) -> re.Pattern | None:
    """Compile a client's breed vocabulary into one alternation."""
    words = sorted({w.strip().lower() for w in breed_words if w and w.strip()})
    if not words:
        return None
    return re.compile("(" + "|".join(re.escape(w) for w in words) + ")", re.I)


# ---------------------------------------------------------------------------
# Row classification
# ---------------------------------------------------------------------------

FIELDS = ("name", "email", "phone", "address", "dog", "breed", "age",
          "dateBooked", "notes")


def classify_row(vals: dict, *, breed_re: re.Pattern | None = None,
                 suburbs: set[str] | None = None,
                 street_re: re.Pattern = DEFAULT_STREET_RE,
                 phone_rules: PhoneRules = NZ_PHONE,
                 subject_column: str = "A",
                 column_order=None) -> dict:
    """
    Turn {column letter: raw value} into a typed record.

    `column_order` lets a caller impose a deterministic left-to-right sweep;
    by default columns are visited in spreadsheet order, which is what makes
    "the first cell that looks like a phone number is the phone number" a
    stable rule rather than a dict-ordering accident.
    """
    rec = {f: None for f in FIELDS}
    notes: list[str] = []

    subject = vals.get(subject_column)
    rec["name"] = subject.strip() if isinstance(subject, str) else subject

    breed_taken = dog_taken = False
    cols = column_order or sorted(vals.keys(), key=_col_index)

    for col in cols:
        if col == subject_column or col not in vals:
            continue
        v = vals[col]
        if v is None:
            continue

        if rec["email"] is None:
            em = find_email(v)
            if em:
                rec["email"] = em
                extra = v.replace(em, "").strip(" /,;|") if isinstance(v, str) else ""
                if extra and len(extra) > 2:
                    notes.append(f"{col}:{extra}")
                continue
        if rec["dateBooked"] is None and looks_like_date(v):
            rec["dateBooked"] = fmt_date(v)
            continue
        if rec["phone"] is None and looks_like_phone(v, phone_rules):
            rec["phone"] = str(int(v)) if isinstance(v, (int, float)) else v.strip()
            continue
        if rec["age"] is None and looks_like_age(v):
            rec["age"] = v.strip()
            continue
        if not breed_taken and rec["breed"] is None and looks_like_breed(v, breed_re):
            rec["breed"] = v.strip()
            breed_taken = True
            continue
        if rec["address"] is None and looks_like_address(v, suburbs, street_re):
            rec["address"] = v.strip()
            continue
        if not dog_taken and rec["dog"] is None and looks_like_dog_name(v):
            rec["dog"] = v.strip()
            dog_taken = True
            continue

        # Unclaimed. Kept verbatim, tagged with the column it came from, so a
        # human can see exactly what we could not read.
        sval = fmt_date(v) if is_datetime(v) else str(v).strip()
        if sval:
            notes.append(f"{col}:{sval}")

    rec["notes"] = " | ".join(notes) if notes else None
    return rec


def compact_raw(vals: dict) -> str:
    """The whole row as "A=… | B=…", for a needs-review entry."""
    parts = []
    for col in sorted(vals.keys(), key=_col_index):
        v = vals[col]
        sval = fmt_date(v) if is_datetime(v) else str(v).strip()
        parts.append(f"{col}={sval}")
    return " | ".join(parts)


def _col_index(letter: str) -> int:
    n = 0
    for ch in letter:
        n = n * 26 + (ord(ch.upper()) - 64)
    return n


def column_letter(index: int) -> str:
    out = ""
    while index > 0:
        index, rem = divmod(index - 1, 26)
        out = chr(65 + rem) + out
    return out


__all__ = [
    "EMAIL_RE", "DATE_STR_RE", "AGE_RE", "DEFAULT_STREET_RE", "DOG_STOP",
    "is_datetime", "fmt_date", "find_email", "looks_like_email",
    "looks_like_date", "looks_like_phone", "looks_like_age",
    "looks_like_address", "looks_like_breed", "looks_like_dog_name",
    "build_breed_re", "classify_row", "compact_raw", "column_letter",
]
