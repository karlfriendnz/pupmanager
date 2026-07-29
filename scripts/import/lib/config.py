"""
The per-client config — everything that is true of ONE client and no other.

WHY THIS EXISTS
---------------
The first import was written for one business, so its vocabulary was spread
through the code as literals: "SP" meant School Pups on line 84, "Allsorts"
was the previous trainer in a regex on line 317, and the fact that a volunteer
should become a custom field called "Volunteer" was an `if` in the middle of
the merge loop. Onboarding a second client meant editing all of it, and the
first client's import stopped being reproducible.

So the split is:

    LAYER 1  code    — how messy data behaves (this toolkit)
    LAYER 2  config  — what this client's shorthand means (a JSON file)

The measure of whether that split worked is the size of layer 2. A new client
should need: which file is which shape, what their class codes mean, what
their service codes mean, and which file wins a disagreement. Nothing else.

TWO ORDERINGS, DELIBERATELY SEPARATE
------------------------------------
`files` is the order files are PROCESSED. The first one is the spine: it
creates most of the people and every later file matches into it.

`priorities` is who WINS a field-level disagreement. They are not the same
thing and conflating them is a bug waiting to happen — the contacts export is
processed third but must never overwrite a phone number from the spreadsheet.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from .dedup import JunkRules
from .notes import NotesGrammar
from .text import DEFAULT_BREED_ALIASES, PhoneRules

DEFAULT_CUSTOM_FIELDS = {
    "volunteer": "Volunteer",
    "professional": "Professional",
    "previousTrainer": "Previous trainer",
    "business": "Business",
    "credit": "Credit",
}


@dataclass
class SourceFile:
    """One input file and the source-shape module that can read it."""
    shape: str
    path: Path
    options: dict = field(default_factory=dict)
    label: str = ""

    @property
    def name(self) -> str:
        return self.label or self.shape


@dataclass
class ClientConfig:
    slug: str
    name: str
    root: Path
    files: list[SourceFile]
    priorities: dict[str, int]

    course_codes: dict[str, str] = field(default_factory=dict)
    service_names: dict[str, str] = field(default_factory=dict)
    service_phrases: tuple[str, ...] = ()
    role_words: tuple[str, ...] = ("intern", "volunteer", "placement")
    prior_providers: tuple[str, ...] = ()
    nickname_junk_extra: tuple[str, ...] = ()
    reference_tag: str = "AF"
    default_course_code: str = ""

    breed_words: tuple[str, ...] = ()
    breed_aliases: dict[str, str] = field(
        default_factory=lambda: dict(DEFAULT_BREED_ALIASES))
    suburbs: tuple[str, ...] = ()

    phone: PhoneRules = field(default_factory=PhoneRules)
    # Only the NAMESPACE is per-client: it seeds the hash so two clients'
    # placeholder addresses can never collide. The DOMAIN belongs to the
    # destination system (lib/dedup.PLACEHOLDER_DOMAIN) and is not a client
    # setting — recognising a placeholder has to work the same everywhere.
    placeholder_namespace: str = "import"
    custom_fields: dict[str, str] = field(
        default_factory=lambda: dict(DEFAULT_CUSTOM_FIELDS))
    junk: JunkRules = field(default_factory=JunkRules)

    # How the wizard-ready CSV is shaped for THIS client.
    #   companyTo      a person's company lands in this custom-field column
    #                  when the column is otherwise empty (the destination
    #                  wizard has no Company field of its own).
    #   oncePerPerson  custom-field columns written on a person's FIRST dog row
    #                  only. Long free text repeated on every row of a
    #                  three-dog family is noise; a short flag is not.
    csv_company_to: str = "Business"
    csv_once_per_person: tuple[str, ...] = ("Credit",)

    # -- derived ----------------------------------------------------------

    def grammar(self) -> NotesGrammar:
        return NotesGrammar(
            course_codes=dict(self.course_codes),
            service_codes=tuple(self.service_names),
            service_names=dict(self.service_names),
            service_phrases=tuple(self.service_phrases),
            role_words=tuple(self.role_words),
            prior_providers=tuple(self.prior_providers),
            nickname_junk_extra=tuple(self.nickname_junk_extra),
            reference_tag=self.reference_tag,
        )

    def custom_field(self, key: str) -> str:
        """The client's label for one of our concepts; "" turns it off."""
        return self.custom_fields.get(key, "") or ""

    # -- loading ----------------------------------------------------------

    @classmethod
    def load(cls, path: str | Path) -> "ClientConfig":
        path = Path(path).expanduser().resolve()
        raw = json.loads(path.read_text(encoding="utf-8"))
        root = Path(raw.get("root") or path.parent).expanduser()

        files = []
        for entry in raw.get("files", []):
            p = Path(entry["path"]).expanduser()
            if not p.is_absolute():
                p = (root / p)
            files.append(SourceFile(shape=entry["shape"], path=p,
                                    options=entry.get("options") or {},
                                    label=entry.get("label", "")))

        phone_raw = raw.get("phone") or {}
        phone = PhoneRules(
            country_code=phone_raw.get("countryCode", "64"),
            trunk_prefix=phone_raw.get("trunkPrefix", "0"),
            mobile_prefixes=tuple(phone_raw.get("mobilePrefixes", ("2",))),
            landline_prefixes=tuple(phone_raw.get("landlinePrefixes",
                                                  ("3", "4", "6", "7", "9"))),
            mobile_len=tuple(phone_raw.get("mobileLength", (9, 11))),
            landline_len=tuple(phone_raw.get("landlineLength", (9, 10))),
        )

        aliases = dict(DEFAULT_BREED_ALIASES)
        aliases.update(raw.get("breedAliases") or {})

        junk = JunkRules()
        for extra in raw.get("dogNameBlocklistExtra") or []:
            junk.dog_name_blocklist.add(extra.strip().lower())

        return cls(
            slug=raw.get("slug") or path.stem,
            name=raw.get("name") or raw.get("slug") or path.stem,
            root=root,
            files=files,
            priorities=dict(raw.get("priorities") or {}),
            course_codes=dict(raw.get("courseCodes") or {}),
            service_names=dict(raw.get("serviceNames") or {}),
            service_phrases=tuple(raw.get("servicePhrases") or ()),
            role_words=tuple(raw.get("roleWords")
                             or ("intern", "volunteer", "placement")),
            prior_providers=tuple(raw.get("priorProviders") or ()),
            nickname_junk_extra=tuple(raw.get("nicknameJunkExtra") or ()),
            reference_tag=raw.get("referenceTag", "AF"),
            default_course_code=raw.get("defaultCourseCode", ""),
            breed_words=tuple(raw.get("breedWords") or ()),
            breed_aliases=aliases,
            suburbs=tuple(raw.get("suburbs") or ()),
            phone=phone,
            placeholder_namespace=raw.get("placeholderNamespace", "import"),
            custom_fields={**DEFAULT_CUSTOM_FIELDS,
                           **(raw.get("customFields") or {})},
            junk=junk,
            csv_company_to=(raw.get("csv") or {}).get("companyTo", "Business"),
            csv_once_per_person=tuple(
                (raw.get("csv") or {}).get("oncePerPerson", ["Credit"])),
        )

    def describe(self) -> str:
        lines = [f"{self.name} ({self.slug})"]
        for f in self.files:
            mark = "ok " if f.path.exists() else "MISSING"
            lines.append(f"  {mark} {f.name:22} {f.shape:22} {f.path}")
        lines.append("  precedence: " + " > ".join(
            k for k, _ in sorted(self.priorities.items(),
                                 key=lambda kv: -kv[1])))
        return "\n".join(lines)
