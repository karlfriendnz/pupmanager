"""
The dog-name judge — is this cell a dog's name, or something else entirely?

WHY THIS EXISTS
---------------
A dog-name column holds whatever was typed in it. In one real file that
included "Pulled out", "Class notes please", "Mixed", "Blue Heeler",
"Labradoodle", and a date. Import those and the client opens their new system
to find a dog called Pulled Out with an attendance record.

The judge answers one question — *is this a name?* — and does two things with
a "no":

  1. returns "" so a real name from another file can win instead, and
  2. writes the original text back onto the PERSON as a note, and into an
     overrides list that surfaces in the review workbook.

That second half is why this is a class and not a function. Filtering without
recording is data loss; this records every single filtered value with the
person it belonged to, where it was found, and why it was rejected.

The vocabulary it judges against is learned from the client's own breed
columns (plus a built-in strong/weak breed list), so a breed this client keeps
that we have never seen is still recognised.
"""

from __future__ import annotations

from .dedup import JunkRules, breed_vocabulary, dog_name_junk_reason
from .text import clean


class DogNameJudge:
    def __init__(self, breeds, *, rules: JunkRules | None = None,
                 aliases: dict[str, str] | None = None) -> None:
        self.vocab = breed_vocabulary(breeds, aliases)
        self.rules = rules or JunkRules()
        self.aliases = aliases
        self.overrides: list[dict] = []
        self._seen: set[tuple] = set()

    def junk_reason(self, raw: str | None) -> str | None:
        return dog_name_junk_reason(raw, breed_vocab=self.vocab,
                                    rules=self.rules, aliases=self.aliases)

    def usable(self, raw: str | None, *, owner: str = "", where: str = "",
               person=None, source: str = "spreadsheet") -> str:
        """
        The name if it is one, else "" — logging the rejection either way.

        An empty cell is not logged: there is nothing to explain about a blank.
        Anything else that gets rejected is recorded once per
        (owner, value, reason) so a value repeated down twenty rows produces
        one review line, not twenty.

        `source` tags the note the rejected text is kept in. It defaults to
        "spreadsheet" because that is what the first client's junk names came
        from and the label was written into the note directly — but a client
        with no spreadsheet then gets notes attributed to a file that does not
        exist, which is exactly the sort of quiet untruth a review is supposed
        to catch rather than contain.
        """
        reason = self.junk_reason(raw)
        if reason is None:
            return clean(raw)
        value = clean(raw)
        if reason != "empty":
            key = (owner, value.lower(), reason)
            if key not in self._seen:
                self._seen.add(key)
                self.overrides.append({
                    "person": owner,
                    "where": where,
                    "value": value,
                    "reason": reason,
                })
                # The text still means something to somebody — keep it.
                if person is not None:
                    person.add_note(f'Dog column on {where} said: "{value}"',
                                    source)
        return ""
