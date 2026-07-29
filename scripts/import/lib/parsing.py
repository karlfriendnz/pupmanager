"""
The reusable parsing helpers — one import for everything a source module needs.

WHY THIS EXISTS
---------------
A source module should be about ONE thing: the shape of one file. It should
not have to know which of five internal modules holds `norm_email`. So this is
the façade: `from lib import parsing` gets you the whole toolkit, and the
implementations live in small single-purpose modules behind it.

    parsing.norm_email / norm_name / digits / addresses_agree …  -> lib/text.py
    parsing.classify_row / looks_like_phone / find_email …       -> lib/classify.py
    parsing.parse_notes / NotesGrammar …                         -> lib/notes.py
    parsing.placeholder_email / dog_name_junk_reason …           -> lib/dedup.py

The façade imports the leaves; the leaves never import the façade, so there is
no circularity and each piece stays independently testable.

THE FOUR HARD-WON RULES worth knowing before you use any of this:

  * Classify cells by CONTENT, never by column position — spreadsheets shift
    columns mid-file and nothing warns you (lib/classify.py).
  * Test for a DATE before you test for a PHONE — "13/12/24" satisfies both
    (lib/classify.py).
  * An EMPTY value never conflicts with anything; it is a gap to fill
    (lib/text.py `values_agree`).
  * A person with no email address must never merge with anyone
    (lib/dedup.py `placeholder_email`).
"""

from __future__ import annotations

# -- normalisation, fuzzy matching, agreement -------------------------------
from .text import (  # noqa: F401
    MACRONS, MONTHS, MONTH_RE, MONTH_NUM, NZ_PHONE, PhoneRules,
    DEFAULT_BREED_ALIASES, VAGUE_BREEDS, ROAD_TYPES,
    addresses_agree, breeds_agree, clean, digits, edit_distance_le1,
    month_num, month_year, name_tokens, names_compatible, norm_breed,
    norm_email, norm_name, norm_nickname, norm_street, parse_dmy,
    plausible_phone, resolve_nickname, split_name, street_key, values_agree,
)

# -- content-based cell classification --------------------------------------
from .classify import (  # noqa: F401
    DOG_STOP, DEFAULT_STREET_RE, EMAIL_RE,
    build_breed_re, classify_row, column_letter, compact_raw, find_email,
    fmt_date, is_datetime, looks_like_address, looks_like_age,
    looks_like_breed, looks_like_date, looks_like_dog_name, looks_like_email,
    looks_like_phone,
)

# -- the multi-line notes blob ----------------------------------------------
from .notes import (  # noqa: F401
    NotesGrammar, extract_nickname, parse_notes, split_dog_names, try_dog_line,
)

# -- identity, placeholders, junk -------------------------------------------
from .dedup import (  # noqa: F401
    JunkRules, PLACEHOLDER_DOMAIN, STRONG_BREED, WEAK_BREED,
    breed_vocabulary, dog_name_junk_reason, is_placeholder,
    is_placeholder_dog_name, looks_like_junk_person, placeholder_email,
)

__all__ = [n for n in dir() if not n.startswith("_")]
