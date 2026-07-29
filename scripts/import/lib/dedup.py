"""
Person identity — matching, placeholder addresses, and junk-value filters.

WHY THIS EXISTS
---------------
Every question in an onboarding reduces to one: *is this the same person?*
Get it wrong in one direction and a client's ten years of history splits into
four half-records. Get it wrong in the other and two families are merged into
one and someone reads somebody else's dog's medical notes.

The rules below are the ones that survived contact with real data.

  1. **Email is the strongest key** and the only one that merges silently.
  2. **Name is a weak key.** It merges, but the merge is always announced in
     needsReview so a human can veto it.
  3. **No email means no merging, ever.** A contact card with no address gets
     an invented placeholder that cannot collide with anything. If someone of
     the same name already exists we say so, loudly, and leave both records —
     because "probably the same person" is a judgement the client should make,
     not the importer.
  4. **A placeholder is not evidence.** A real address always beats one, from
     any file, with no conflict recorded.

PLACEHOLDER ADDRESSES
---------------------
Deterministic (sha256 of a stable seed) so re-running the pipeline produces
byte-identical output, which is what makes a diff between two runs meaningful.
The shape matches what the app's own client API mints, so a placeholder made
here and one made there are indistinguishable downstream.

JUNK VALUES
-----------
A column holds what someone typed in it, not what it was labelled. Dog-name
columns hold "Pulled out", "Class notes please", "Mixed" and bare breed names.
Client-name columns hold "REHOMED" and "-". Filtering those is not data loss:
the value is written back into the person's notes and listed in the review
workbook. It just stops "Pulled out" becoming a dog with a medical record.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field

from .text import clean, norm_breed, norm_name

PLACEHOLDER_DOMAIN = "no-email.pupmanager.app"


# ---------------------------------------------------------------------------
# Placeholder addresses
# ---------------------------------------------------------------------------

def placeholder_email(seed: str, namespace: str = "import",
                      domain: str = PLACEHOLDER_DOMAIN) -> str:
    """Deterministic, collision-free, obviously fake. See module docstring."""
    h = hashlib.sha256(f"{namespace}::{seed}".encode()).hexdigest()[:16]
    return f"noemail-{h}@{domain}"


def is_placeholder(email: str, domain: str = PLACEHOLDER_DOMAIN) -> bool:
    return bool(email) and email.endswith("@" + domain)


# ---------------------------------------------------------------------------
# Junk filters
# ---------------------------------------------------------------------------

# Split in two so a dog genuinely called "Blue" survives.
#
# STRONG — a word that is a breed and effectively never a given name. One of
#          these alone means the cell holds a breed.
# WEAK   — a word that only reads as a breed next to a strong one. "Blue
#          Heeler" is a breed; "Blue" is a perfectly good dog.
STRONG_BREED = {
    "terrier", "retriever", "shepherd", "shepard", "spaniel", "hound", "heeler",
    "collie", "poodle", "labradoodle", "cavoodle", "cavapoo", "pomapoo",
    "spoodle", "schnoodle", "groodle", "goldendoodle", "cockapoo", "mastiff",
    "bulldog", "dogue", "pointer", "setter", "husky", "corgi", "schnauzer",
    "dachshund", "beagle", "labrador", "whippet", "greyhound", "ridgeback",
    "malamute", "akita", "chihuahua", "rottweiler", "doberman", "dobermann",
    "vizsla", "weimaraner", "staffy", "staffie", "staffordshire", "kelpie",
    "huntaway", "samoyed", "shiba", "papillon", "maltese", "bichon",
    "newfoundland", "leonberger", "wolfhound", "deerhound", "saluki", "basenji",
    "dane", "pomeranian", "havanese", "keeshond", "schipperke", "crossbreed",
}
WEAK_BREED = {
    "blue", "red", "black", "white", "tan", "german", "golden", "american",
    "english", "french", "border", "bernese", "mountain", "jack", "russell",
    "fox", "foxy", "bull", "pit", "pitbull", "cocker", "springer", "shih",
    "tzu", "pyrenees", "inu", "miniature", "mini", "standard", "toy", "cross",
    "x", "mix", "mixed", "smooth", "wire", "haired", "shorthaired",
    "longhaired", "working", "show", "heading", "rough", "short", "long",
    "dog", "dogs", "pup", "puppy", "rescue", "lab", "boxer", "pug", "frise",
    "beardie", "bearded", "rottie", "breed",
}

DEFAULT_DOG_NAME_BLOCKLIST = {
    "pulled out", "pulled  out", "class notes please", "classnotes please",
    "mixed", "n a", "na", "tbc", "unknown", "none", "no dog", "x",
}

DEFAULT_JUNK_PERSON_RE = re.compile(
    r"^(rehomed|pulled out|cancelled|class notes|n/a|unknown|tbc|-+)$", re.I)

PLACEHOLDER_DOG_NAMES = {"tbc", "tba", "n/a", "na", "unknown", "puppy", "pup",
                         "dog"}


@dataclass
class JunkRules:
    """Per-client tuning of what counts as a non-value."""
    dog_name_blocklist: set[str] = field(
        default_factory=lambda: set(DEFAULT_DOG_NAME_BLOCKLIST))
    strong_breed: set[str] = field(default_factory=lambda: set(STRONG_BREED))
    weak_breed: set[str] = field(default_factory=lambda: set(WEAK_BREED))
    person_name_re: re.Pattern = DEFAULT_JUNK_PERSON_RE


def looks_like_junk_person(name: str, rules: JunkRules | None = None) -> bool:
    rules = rules or JunkRules()
    n = clean(name)
    return bool(rules.person_name_re.match(n)) or len(n) < 2


def dog_name_junk_reason(raw: str | None, *, breed_vocab: set[str],
                         rules: JunkRules | None = None,
                         aliases: dict[str, str] | None = None) -> str | None:
    """
    Why this dog-name cell is not a dog's name — or None if it is one.

    `breed_vocab` is learned from the client's OWN breed columns, so a breed
    they actually keep is recognised even if it is not in the built-in list.
    """
    rules = rules or JunkRules()
    s = clean(raw)
    if not s:
        return "empty"
    base = re.sub(r"\(.*?\)", " ", s).strip()          # drop "(F)", "(M)"
    key = norm_name(base)
    if not key:
        return "empty"
    if key in rules.dog_name_blocklist:
        return "blocklist"

    toks = key.split()
    all_breed_words = all(t in rules.strong_breed or t in rules.weak_breed
                          for t in toks)
    has_strong = any(t in rules.strong_breed for t in toks)

    # One word only counts if it is unmistakably a breed — a dog really can be
    # called "Blue", but nobody calls one "Doberman".
    if len(toks) == 1:
        return "breed-name-only" if has_strong else None
    # Two or more words that are ALL breed vocabulary ("Blue Heeler", "Lab
    # mix"). "Frankie Bear" and "Tim Tam" are untouched.
    if all_breed_words:
        return "breed-name-only"
    # Or the whole string is a breed we have seen in this client's own data.
    if has_strong and norm_breed(base, aliases) in breed_vocab:
        return "breed-name-only"
    return None


def is_placeholder_dog_name(name: str) -> bool:
    """"TBC" / "Puppy" — a real cell holding "we do not know yet"."""
    n = clean(name).lower()
    return n in PLACEHOLDER_DOG_NAMES


def breed_vocabulary(breeds, aliases: dict[str, str] | None = None) -> set[str]:
    """
    Build the client's own breed vocabulary from whatever breeds appear in
    their files — the whole normalised phrase plus each word over four letters,
    so "German Shorthaired Pointer" also teaches us "shorthaired".
    """
    vocab: set[str] = set()
    for b in breeds:
        nb = norm_breed(b, aliases)
        if not nb:
            continue
        vocab.add(nb)
        for w in nb.split():
            if len(w) > 4:
                vocab.add(w)
    return vocab
