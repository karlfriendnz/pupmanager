"""
Source shape: a MoeGo CLIENT & PET LIST export (.csv).

WHAT THIS SHAPE LOOKS LIKE
--------------------------
The file MoeGo produces from the Client & Pet List when the contact columns
have been switched on before Download. Unlike `moego_appointments`, this is
row-per-PERSON and it is the business's whole book — everyone, not just
whoever happened to book inside a date range:

    First name | Last name | email | Primary contact | additional contact |
    address | pet(Breed) | Total sales | Last service | Next service |
    status | preferred groomer | notes | create date | ...

It is the SPINE. Processed first, it creates the people every other MoeGo
file then matches into.

THREE THINGS ABOUT IT THAT BITE
-------------------------------
1. **Every header and every value has a trailing TAB.** MoeGo writes
   `"First name\\t"` as the column name and `"Test\\t"` as the value. Look up
   a column by its printed name and you get nothing, silently — the whole
   import comes out empty and valid. Headers are matched on their stripped
   form for that reason.

2. **The `notes` column is mostly not notes.** In the first real file, 9 of
   13 were a bare phone number, one was an address, and two were an actual
   note. That is the toolkit's oldest rule arriving from a new direction:
   classify by CONTENT, never by the column it came in. A second number in
   `notes` is a second number, not a sentence about the client.

3. **The phone column is never empty and often not a phone.** `00000`, `111`,
   `8`, `22222` — MoeGo requires a contact number, so the front desk types
   something. An implausible number is kept verbatim on the person and
   reported, never silently written into a field that Rachael might one day
   text.

WHAT BECOMES WHAT
-----------------
    First/Last name        -> the person ('?' surnames and couples handled)
    email                  -> the real address; blank means a placeholder
    Primary contact        -> phone, when it is plausibly one
    additional contact     -> a custom field
    address                -> address
    pet(Breed)             -> dogs, "Name(Breed),Name(Breed)"
    notes                  -> classified per line, not assumed to be prose
    the trading columns    -> custom fields (last groom, spend, frequency…)

MARKETING CONSENT IS NOT A SUBSCRIBER RECORD
--------------------------------------------
`has subscribed marketing email` is Yes for almost everybody, and the plan
has a `subscribers[]` concept that would happily take them. It is deliberately
NOT used: a Subscriber row is a live mailing list in the destination, and
turning a column in a spreadsheet into 450 people who can be emailed is not a
decision an importer gets to make quietly. The consent is recorded as a custom
field, where somebody can see it and act on it on purpose.
"""

from __future__ import annotations

import csv
import re
from pathlib import Path

from lib import parsing
from lib.plan_schema import empty_fragment, empty_person_fragment

SHAPE = "moego_clients"

DEFAULT_COLUMNS = {
    "firstName": "First name",
    "lastName": "Last name",
    "email": "email",
    "phone": "Primary contact",
    "phone2": "additional contact",
    "address": "address",
    "pets": "pet(Breed)",
    "totalSales": "Total sales",
    "lastService": "Last service",
    "nextService": "Next service",
    "status": "status",
    "preferredGroomer": "preferred groomer",
    "lastApptGroomer": "last appt groomer",
    "notes": "notes",
    "createDate": "create date",
    "referral": "referral source",
    "marketing": "has subscribed marketing email",
    "totalBookings": "total booking number",
    "upcomingBookings": "upcoming booking number",
    "overdueDays": "overdue days",
    "tags": "tags",
    "preferredFrequency": "preferred frequency",
    "preferredDay": "preferred day of week",
}

#: "Ellie(Shih Tzu)" / "Labradoodle (h)" keeps its own brackets, so the split
#: is on the LAST opening bracket that closes at the end of the entry.
PET_RE = re.compile(r"^(?P<name>.*?)\s*\((?P<breed>.*)\)$")

#: "Gary & Gloria Rawson" — see moego_appointments for the same rule.
COUPLE_RE = re.compile(
    r"^(?P<a>[^\s&]+)\s*(?:&|\+|\band\b)\s*(?P<b>[^\s&]+)\s+(?P<last>.+)$",
    re.IGNORECASE)

#: A name cell that is only punctuation: MoeGo requires one, nobody knew it.
UNKNOWN_NAME_RE = re.compile(r"^[?\-–—.\s]*$")


def _rows(path: Path, cols: dict) -> list[dict]:
    """
    Every row as {our key: value}, matching headers on their STRIPPED form.

    MoeGo suffixes every header and every value with a tab. Matching on the
    printed name returns nothing for every column, and an import that reads
    no columns produces an empty plan that passes validation — a silent,
    confident, completely wrong result. Hence stripping both sides.
    """
    with path.open(newline="", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        try:
            header = [h.strip() for h in next(reader)]
        except StopIteration:
            return []
        where = {key: header.index(label)
                 for key, label in cols.items() if label in header}
        out = []
        for n, raw in enumerate(reader, start=2):
            if not any((c or "").strip() for c in raw):
                continue
            row = {key: (raw[i].strip() if i < len(raw) else "")
                   for key, i in where.items()}
            row["_row"] = n
            out.append(row)
    return out


def _missing_columns(path: Path, cols: dict) -> list[str]:
    with path.open(newline="", encoding="utf-8-sig") as f:
        try:
            header = [h.strip() for h in next(csv.reader(f))]
        except StopIteration:
            return sorted(cols.values())
    return sorted(label for label in cols.values() if label not in header)


def _service_date(value: str) -> str:
    """'2026-07-17 13:30-13:40' -> '2026-07-17'. Blank when unreadable."""
    m = re.match(r"^(\d{4}-\d{2}-\d{2})", parsing.clean(value))
    return m.group(1) if m else ""


def _money(value: str) -> str:
    """'$90.0' -> '$90'. Left alone if it is not the shape we expect."""
    m = re.match(r"^\$?(\d+(?:\.\d+)?)$", parsing.clean(value))
    if not m:
        return parsing.clean(value)
    amount = float(m.group(1))
    return f"${amount:,.2f}".replace(".00", "")


def vocabulary(path: Path, options: dict) -> dict:
    """The breed inside every bracket, which is this client's own spelling."""
    cols = {**DEFAULT_COLUMNS, **(options.get("columns") or {})}
    breeds: list[str] = []
    for row in _rows(path, cols):
        for entry in _split_pets(row.get("pets", "")):
            m = PET_RE.match(entry)
            if m and m.group("breed"):
                breeds.append(m.group("breed").replace("\xa0", " ").strip())
    return {"breeds": breeds, "suburbs": set()}


def _split_pets(cell: str) -> list[str]:
    return [p.strip() for p in (cell or "").split(",") if p.strip()]


def extract(path: Path, options: dict, ctx) -> list[dict]:
    cols = {**DEFAULT_COLUMNS, **(options.get("columns") or {})}
    label = options.get("label") or "clients"
    skip_names = {n.strip().lower() for n in (options.get("skipNames") or ())}
    cf = options.get("customFieldLabels") or {}

    frag = empty_fragment(label)
    frag["messages"] = {
        "twinKind": "Two client records, same name, no email",
        "twinDetail": (
            "'{twinName}' ({twinId}) already exists with the same name and no "
            "shared email address, so this row was kept as its own person "
            "({personId}). MoeGo had them as two clients — if they are one "
            "person, merge them."),
    }

    missing = _missing_columns(path, cols)
    if missing:
        frag["needsReview"].append({
            "kind": "Columns missing from the export", "who": "",
            "detail": "This export has no " + ", ".join(missing) +
                      " column. Anything those would have carried is not in "
                      "this import. Switch the columns on in the Client & Pet "
                      "List before downloading and re-run."})

    rows = _rows(path, cols)
    if not rows:
        frag["needsReview"].append({
            "kind": "Empty client export", "who": "",
            "detail": f"{path.name} has a header row and no clients."})
        return [frag]

    suburbs = set(options.get("suburbs") or ()) | set(ctx.suburb_vocab or ())
    kept = 0
    seen_names: dict[str, str] = {}   # normalised name -> the row that had it

    for row in rows:
        source_row = f"row {row['_row']}"
        first = parsing.clean(row.get("firstName"))
        last = parsing.clean(row.get("lastName"))
        display, surname_unknown = _display_name(first, last, source_row, frag)

        if not display:
            frag["needsReview"].append({
                "kind": "Client row with no name", "who": "",
                "detail": f"{source_row} has neither a first nor a last name. "
                          f"It was not imported."})
            continue
        if display.lower() in skip_names:
            frag["needsReview"].append({
                "kind": "Test record skipped", "who": display,
                "detail": f"{source_row} is '{display}', named in the client "
                          f"config as a MoeGo test record. Not imported."})
            continue

        p = empty_person_fragment(label)
        p["name"] = display
        p["sourceRow"] = source_row
        p["sourceKey"] = f"moego-client::{display}::{row['_row']}"
        _apply_couple(p, display, frag)

        # Two rows, one name. Whether that is one person or two is a judgement
        # about this business's customers, so it is never made silently.
        key = parsing.norm_name(display)
        if key in seen_names:
            if surname_unknown:
                # 'Paula ?' twice is two clients called Paula whose surnames
                # nobody recorded — different phones, different dogs. Fusing
                # them on a first name would invent one customer out of two,
                # and no later file can ever take that back.
                p["allowNameMatch"] = False
                frag["needsReview"].append({
                    "kind": "Two clients share a first name and have no surname",
                    "who": display,
                    "detail": f"{source_row} is a second '{display}' "
                              f"({seen_names[key]} was the first) and neither "
                              f"has a surname. Kept as two people — MoeGo had "
                              f"them as two clients. Merge them if they are "
                              f"one."})
            else:
                frag["needsReview"].append({
                    "kind": "Two client records with the same name",
                    "who": display,
                    "detail": f"{source_row} has the same name as "
                              f"{seen_names[key]}. They were merged into one "
                              f"person — MoeGo held them as two clients, so "
                              f"check that is right before relying on it."})
        else:
            seen_names[key] = source_row

        email = parsing.norm_email(row.get("email"))
        if email and parsing.looks_like_email(email):
            p["email"] = email
        elif email:
            frag["needsReview"].append({
                "kind": "Email is not an address", "who": display,
                "detail": f"{source_row}: {email!r} is in the email column but "
                          f"is not an address. Kept on the notes; the client "
                          f"gets a placeholder."})
            p["notes"].append(f"MoeGo email column: {email}")

        _apply_phone(p, row.get("phone"), display, source_row, frag, ctx,
                     cf.get("phone2", "Additional phone"))
        extra = parsing.clean(row.get("phone2"))
        if extra:
            _add_extra_phone(p, extra, cf.get("phone2", "Additional phone"))

        address = parsing.clean(row.get("address"))
        if address:
            p["address"] = address

        _apply_pets(p, row.get("pets", ""), display, source_row, frag)
        _apply_notes(p, row.get("notes"), display, source_row, frag, ctx,
                     suburbs, cf.get("phone2", "Additional phone"))
        _apply_trading(p, row, cf)

        status = parsing.clean(row.get("status")).lower()
        if status and status != "active":
            p["flags"].append(f"MoeGo status: {status}")
            p["notes"].append(f"Marked '{status}' in MoeGo.")

        frag["people"].append(p)
        kept += 1

    frag["needsReview"].append({
        "kind": "What this export covers", "who": "",
        "detail": f"{kept} client(s) from {path.name} — the whole book, not a "
                  f"date range. "
                  f"{sum(1 for x in frag['people'] if x['email'])} have a real "
                  f"email address; the rest get a placeholder and cannot be "
                  f"invited to log in until one is known."})
    return [frag]


# ---------------------------------------------------------------------------
# Field by field
# ---------------------------------------------------------------------------

def _display_name(first: str, last: str, source_row: str,
                  frag: dict) -> tuple[str, bool]:
    """
    (name, was the surname unknown?).

    '?' is MoeGo's blank. It appears as a surname ('Paula ?'), a doubled
    surname ('Marsha ??') and occasionally as the first name ('? Ridley').
    Imported verbatim it becomes part of the client's name forever.

    The second return value matters because stripping an unknown surname makes
    two different people look identical: two rows of 'Paula ?' both become
    'Paula'. The caller uses it to refuse a name match rather than fuse them.
    """
    f_unknown = bool(first) and bool(UNKNOWN_NAME_RE.match(first))
    l_unknown = bool(last) and bool(UNKNOWN_NAME_RE.match(last))
    kept_first = "" if f_unknown else first
    kept_last = "" if l_unknown else last
    display = " ".join(x for x in (kept_first, kept_last) if x)

    if f_unknown or l_unknown:
        which = "first name" if f_unknown else "surname"
        frag["needsReview"].append({
            "kind": f"Client has no {which}", "who": display or "(unnamed)",
            "detail": f"{source_row}: MoeGo has this client as "
                      f"{(first + ' ' + last).strip()!r} — the {which} was "
                      f"never filled in. Imported as "
                      f"{display or 'an unnamed client'}."})
    return display, (l_unknown or not last)


def _apply_couple(p: dict, display: str, frag: dict) -> None:
    """'Norman & Carol Taylor' is one household with one surname."""
    m = COUPLE_RE.match(display)
    if not m:
        return
    first, partner, last = m.group("a"), m.group("b"), m.group("last")
    p["firstName"] = first
    p["lastName"] = last
    p["notes"].append(f"MoeGo account is in two names: "
                      f"{first} and {partner} {last}.")
    frag["needsReview"].append({
        "kind": "Two people on one account", "who": display,
        "detail": f"'{display}' is a household, not a person. Imported as "
                  f"{first} {last}; {partner} {last} is named in the notes."})


def _apply_phone(p: dict, raw, who: str, source_row: str, frag: dict, ctx,
                 extra_label: str) -> None:
    """
    MoeGo will not save a client without a contact number, so when nobody has
    one the front desk types '00000' or '8'. Writing that into the phone field
    makes it look like a number somebody could ring.
    """
    value = parsing.clean(raw)
    if not value:
        return
    ok, why = parsing.plausible_phone(value, ctx.config.phone)
    if ok:
        p["phone"] = value
        return
    p["notes"].append(f"MoeGo phone column: {value} (not a usable number)")
    frag["needsReview"].append({
        "kind": "Phone number is not a phone number", "who": who,
        "detail": f"{source_row}: {value!r} {why}. MoeGo requires a number, so "
                  f"this is almost certainly a placeholder somebody typed. "
                  f"Left off the phone field and kept in the notes."})


def _add_extra_phone(p: dict, value: str, label: str) -> None:
    if not label:
        p["notes"].append(f"Second contact number: {value}")
        return
    existing = p["customFields"].get(label, "")
    if value not in existing:
        p["customFields"][label] = (f"{existing}, {value}".strip(", ")
                                    if existing else value)


def _apply_pets(p: dict, cell: str, who: str, source_row: str,
                frag: dict) -> None:
    by_name: dict[str, str] = {}   # dog name -> the breed already claimed

    for entry in _split_pets(cell):
        m = PET_RE.match(entry)
        name = parsing.clean(m.group("name")) if m else parsing.clean(entry)
        breed = (m.group("breed").replace("\xa0", " ").strip() if m else "")

        if not name or UNKNOWN_NAME_RE.match(name):
            # '?(Mastiff)' — a real dog whose name was never recorded.
            frag["needsReview"].append({
                "kind": "Pet with no name", "who": who,
                "detail": f"{source_row}: MoeGo has a pet recorded only as "
                          f"{entry!r}. No dog was created — ask what it is "
                          f"called."})
            p["notes"].append(f"Has a pet MoeGo records only as {entry!r} — "
                              f"name unknown, so no dog record was created.")
            continue

        key = parsing.norm_name(name)
        if key in by_name:
            # Dogs are deduped by name within a household, so two dogs really
            # called the same thing collapse into one and the second breed is
            # quietly set aside. Two Rubys of different breeds are two dogs.
            if breed and parsing.norm_breed(breed) != parsing.norm_breed(by_name[key]):
                frag["needsReview"].append({
                    "kind": "Two dogs in one household with the same name",
                    "who": who,
                    "detail": f"{source_row}: {who} has two pets called "
                              f"'{name}' — a {by_name[key]} and a {breed}. "
                              f"Dogs are deduped by name, so only one was "
                              f"created, as the {by_name[key]}. Rename one in "
                              f"MoeGo if they are both still coming."})
            continue
        by_name[key] = breed

        p["dogs"].append({"name": name, "breed": breed, "note": "",
                          "judge": True, "where": source_row,
                          "requireName": True})


def _apply_notes(p: dict, raw, who: str, source_row: str, frag: dict, ctx,
                 suburbs: set, extra_label: str) -> None:
    """
    The notes column, classified line by line. Nine of the first thirteen were
    a bare phone number and one was a street address; treating the column as
    prose would have buried four working phone numbers in a text field.
    """
    text = parsing.clean(raw)
    if not text:
        return
    for line in re.split(r"[\n,]", text):
        line = line.strip()
        if not line:
            continue
        if parsing.looks_like_phone(line, ctx.config.phone):
            ok, _ = parsing.plausible_phone(line, ctx.config.phone)
            if ok:
                if not p["phone"]:
                    p["phone"] = line
                else:
                    _add_extra_phone(p, line, extra_label)
                continue
        if parsing.looks_like_address(line, suburbs):
            p["addressHints"].append(line)
            continue
        p["notes"].append(line)


def _apply_trading(p: dict, row: dict, cf: dict) -> None:
    """The columns that describe the trading relationship, as custom fields."""
    pairs = (
        ("lastGroom", "Last groom", _service_date(row.get("lastService", ""))),
        ("nextBooking", "Next booking", _service_date(row.get("nextService", ""))),
        ("groomer", "Usual groomer", parsing.clean(row.get("preferredGroomer"))
         or parsing.clean(row.get("lastApptGroomer"))),
        ("totalSales", "Total spend", _money(row.get("totalSales", ""))),
        ("totalBookings", "Total bookings", parsing.clean(row.get("totalBookings"))),
        ("clientSince", "Client since",
         _service_date(row.get("createDate", ""))
         or parsing.clean(row.get("createDate")).split(" ")[0]),
        ("frequency", "Preferred frequency (days)",
         parsing.clean(row.get("preferredFrequency"))),
        ("marketing", "Marketing consent (MoeGo)",
         parsing.clean(row.get("marketing"))),
    )
    for key, default_label, value in pairs:
        label = cf.get(key, default_label)
        if label and value and value not in ("$0", "0"):
            p["customFields"][label] = value

    referral = parsing.clean(row.get("referral"))
    if referral:
        label = cf.get("referral", "Referral source")
        if label:
            p["customFields"][label] = referral
    for tag in (t.strip() for t in parsing.clean(row.get("tags")).split(",")):
        if tag:
            p["notes"].append(f"MoeGo tag: {tag}")
