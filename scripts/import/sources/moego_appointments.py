"""
Source shape: a MoeGo APPOINTMENT LIST REPORT (.xlsx).

WHAT THIS SHAPE LOOKS LIKE
--------------------------
MoeGo is grooming software. Every list view in it has a Download button, and
what comes out is "the columns that happened to be switched on, for the date
range that happened to be selected". So this shape is a *diary extract*, not a
client list:

    Booking ID | Appointment date | Client ID | Client name | Pet name |
    Pet type | Pet breed | Services | Add-ons | Gross sales | Net sales |
    Staffs | Status | Payment status | Created date | Source | ...

One row is one APPOINTMENT. A client with four grooms is four rows; a client
who did not book inside the window is not in the file at all.

WHY IT IS ITS OWN SHAPE
-----------------------
Three things are true of it that are not true of any other shape here:

1. **It is row-per-event, not row-per-person.** Every other source hands us
   people. This hands us a diary and expects us to work out who the people
   are. `Client ID` is what makes that safe — MoeGo's own primary key, stable
   across every export it will ever produce, so two rows are the same person
   when the ID says so and never because the names look alike.

2. **It usually carries no way to contact anybody.** Email, phone and address
   are columns you have to switch on before downloading, and the default view
   does not. A file like this therefore produces a room full of people with
   placeholder addresses, which is a real cost and is reported loudly rather
   than absorbed quietly — see `contactless` in the review notes.

3. **Its lists are parallel, and ragged.** A two-dog appointment writes
   `Luna,Ronin` / `Border Collie,Cavapoo (h)` / `BBN - LC - Large,Full Groom -
   Small`. Sometimes the lists are the same length and the pairing is obvious.
   Sometimes there are two pets and one breed, and the honest answer is that
   we do not know which dog is the Westie. We pair only when the lengths
   agree; otherwise the raw cell is kept and a human is asked.

WHAT BECOMES WHAT
-----------------
    Client ID + Client name        -> a person (one per ID, however many rows)
    Pet name / Pet breed           -> that person's dogs, unioned over rows
    Services on a completed row    -> a 1:1 consult (Package + ClientPackage)
    every row, completed or not    -> one note line, so the diary survives
    Client ID                      -> a custom field, so the NEXT export can
                                      be reconciled against this import exactly

A consult carries a month and a year and no day (`lib/plan_schema.CONSULT_KEYS`),
so two grooms of the same service in the same month collapse into one record.
That is a real loss and there is no point hiding it: the exact date of every
appointment is written into the person's notes, and the collapse is counted
and reported.

WHICH ROWS BECOME CONSULTS
--------------------------
Only the statuses named in `consultStatuses` (default: `Finished`). An
appointment that was cancelled, no-showed, or is still sitting unconfirmed in
next month's diary is not a service anybody received, and inventing a
purchase record for one would be making the client's history up. Those rows
still become notes, and the soonest future booking becomes a custom field, so
nothing in the file is thrown away.
"""

from __future__ import annotations

import re
from datetime import date, datetime
from pathlib import Path

import openpyxl

from lib import parsing
from lib.plan_schema import empty_fragment, empty_person_fragment

SHAPE = "moego_appointments"

DEFAULT_COLUMNS = {
    "bookingId": "Booking ID",
    "date": "Appointment date",
    "clientId": "Client ID",
    "clientName": "Client name",
    "petName": "Pet name",
    "petType": "Pet type",
    "petBreed": "Pet breed",
    "services": "Services",
    "addOns": "Add-ons",
    "gross": "Gross sales",
    "net": "Net sales",
    "staff": "Staffs",
    "status": "Status",
    "paymentStatus": "Payment status",
    "duration": "Estimate duration",
    "business": "Business name",
}

DEFAULT_CONSULT_STATUSES = ("Finished",)

# MoeGo separates parallel list values with a bare comma. A breed can legally
# contain one ("Cavapoo (h), mini") but in this export never does, so a plain
# split is right — and if a client's data ever proves otherwise, the ragged
# -length guard below catches it rather than silently mispairing a dog.
LIST_SEP = ","

MONTH_NAMES = ("January", "February", "March", "April", "May", "June", "July",
               "August", "September", "October", "November", "December")


# ---------------------------------------------------------------------------
# Reading
# ---------------------------------------------------------------------------

def _rows(path: Path, cols: dict) -> list[dict]:
    """
    Every data row as {our key: cell}, keyed by CONFIGURED header name.

    Loaded WITHOUT read_only on purpose. MoeGo's writer declares the sheet's
    dimension as `A1:A1` regardless of what is in it, and openpyxl's read-only
    mode believes that declaration — so the whole file reads as one header
    cell and no appointments, silently and with no error. The normal loader
    measures the sheet itself. These exports are a few hundred rows; the
    memory this costs is not worth the failure it avoids.
    """
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb.active
    grid = ws.iter_rows(values_only=True)
    try:
        header = [parsing.clean(h) for h in next(grid)]
    except StopIteration:
        return []
    where = {key: header.index(label)
             for key, label in cols.items() if label in header}
    out = []
    for n, raw in enumerate(grid, start=2):
        if not any(v not in (None, "") for v in raw):
            continue
        row = {key: (raw[i] if i < len(raw) else None)
               for key, i in where.items()}
        row["_row"] = n
        out.append(row)
    wb.close()
    return out


def _as_date(value) -> date | None:
    """MoeGo writes dd/mm/yyyy as text; openpyxl sometimes types it anyway."""
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = parsing.clean(value)
    if not text:
        return None
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})$", text)
    if m:
        d, mo, y = (int(g) for g in m.groups())
        try:
            return date(y, mo, d)
        except ValueError:
            return None
    return None


def _split(value) -> list[str]:
    return [s for s in (parsing.clean(p)
                        for p in str(value or "").split(LIST_SEP)) if s]


def _money(value) -> str:
    if value in (None, ""):
        return ""
    try:
        amount = float(value)
    except (TypeError, ValueError):
        return parsing.clean(value)
    return f"${amount:,.2f}".replace(".00", "")


def _pretty(d: date) -> str:
    return f"{d.day} {MONTH_NAMES[d.month - 1]} {d.year}"


# ---------------------------------------------------------------------------
# The shape's two entry points
# ---------------------------------------------------------------------------

def vocabulary(path: Path, options: dict) -> dict:
    """
    What this file can teach later files. Its breed column is the client's own
    breed vocabulary, spelled the way they spell it — 'Maltishu', 'Spoodle',
    'Cavapoo (h)' — which is exactly what a notes parser needs to tell a dog
    from a service code in some other file.
    """
    cols = {**DEFAULT_COLUMNS, **(options.get("columns") or {})}
    breeds: list[str] = []
    for row in _rows(path, cols):
        breeds.extend(_split(row.get("petBreed")))
    return {"breeds": breeds, "suburbs": set()}


def extract(path: Path, options: dict, ctx) -> list[dict]:
    cols = {**DEFAULT_COLUMNS, **(options.get("columns") or {})}
    label = options.get("label") or "appointments"
    statuses = {s.lower() for s in
                (options.get("consultStatuses") or DEFAULT_CONSULT_STATUSES)}
    id_field = options.get("clientIdCustomField", "")
    last_field = options.get("lastVisitCustomField", "")
    next_field = options.get("nextBookingCustomField", "")
    groomer_field = options.get("groomerCustomField", "")
    known_services = {k.upper() for k in (ctx.config.service_names or {})}

    frag = empty_fragment(label)
    # MoeGo's Client ID is a primary key, so this file has already resolved its
    # own duplicates — but we do NOT set selfDeduped, because that would also
    # stop these people matching into a client-list export processed before
    # them. Deduplication happens here, by ID; matching across files stays the
    # engine's job.
    frag["messages"] = {
        "twinKind": "Grooming client with no email",
        "twinDetail": (
            "This appointment-report client has no email address anywhere, so "
            "they were kept as their own person ({personId}) with a "
            "placeholder address. '{twinName}' ({twinId}, {twinEmail}) has the "
            "same name and may be the same person."),
    }

    rows = _rows(path, cols)
    if not rows:
        frag["needsReview"].append({
            "kind": "Empty appointment report", "who": "",
            "detail": f"{path.name} has a header row and no appointments."})
        return [frag]

    people: dict[str, dict] = {}          # client id -> person fragment
    diary: dict[str, list[tuple]] = {}    # client id -> (date, line) to sort
    dates: dict[str, dict] = {}           # client id -> {last, next}
    collapse: dict[tuple, int] = {}       # (id, service, ym) -> how many
    unmapped: dict[str, int] = {}
    businesses: set[str] = set()
    staff_names: set[str] = set()
    today = options.get("today")
    today = _as_date(today) or date.today()

    for row in rows:
        cid = parsing.clean(row.get("clientId"))
        name = parsing.clean(row.get("clientName"))
        when = _as_date(row.get("date"))
        status = parsing.clean(row.get("status"))
        source_row = f"row {row['_row']}"
        businesses.add(parsing.clean(row.get("business")))

        if not cid and not name:
            frag["needsReview"].append({
                "kind": "Appointment with no client", "who": "",
                "detail": f"{source_row} names neither a client nor a client "
                          f"ID; it could not be attached to anybody."})
            continue

        key = cid or f"name::{parsing.norm_name(name)}"
        if not cid:
            frag["needsReview"].append({
                "kind": "Appointment with no client ID", "who": name,
                "detail": f"{source_row} has a client name but no MoeGo "
                          f"client ID, so it was matched on name alone."})

        p = people.get(key)
        if p is None:
            p = empty_person_fragment(label)
            p["name"] = _tidy_name(name, p, frag)
            p["sourceKey"] = f"moego::{cid or parsing.norm_name(name)}"
            p["sourceRow"] = source_row
            if id_field and cid:
                p["customFields"][id_field] = cid
            people[key] = p
            diary[key] = []
            dates[key] = {"last": None, "next": None}
        elif name and parsing.norm_name(name) != parsing.norm_name(p["name"]):
            # Same MoeGo ID, two spellings of the name. The ID wins; the other
            # spelling is worth seeing.
            frag["needsReview"].append({
                "kind": "One client ID, two names", "who": p["name"],
                "detail": f"Client {cid} appears as both '{p['name']}' and "
                          f"'{name}' ({source_row}). Kept as one person under "
                          f"the first spelling."})

        _add_pets(p, row, frag, source_row)

        services = _split(row.get("services"))
        add_ons = _split(row.get("addOns"))
        staff = parsing.clean(row.get("staff"))
        staff_names.update(s for s in _split(staff)
                           if s.lower() != "unassigned staff")
        if groomer_field and staff:
            p["customFields"].setdefault(groomer_field, staff.split(",")[0])

        if when is None:
            frag["needsReview"].append({
                "kind": "Appointment with no readable date", "who": p["name"],
                "detail": f"{source_row}: could not read "
                          f"{row.get('date')!r} as a date. The appointment is "
                          f"in the notes; no service record was created."})
        else:
            if when <= today and (dates[key]["last"] is None
                                  or when > dates[key]["last"]):
                dates[key]["last"] = when
            if when > today and (dates[key]["next"] is None
                                 or when < dates[key]["next"]):
                dates[key]["next"] = when

        diary[key].append((when or date.max,
                           _diary_line(row, when, services, add_ons, status)))

        if not services:
            if status.lower() not in ("cancelled", "no-show"):
                frag["needsReview"].append({
                    "kind": "Appointment with no service", "who": p["name"],
                    "detail": f"{source_row} ({_pretty(when) if when else '?'}, "
                              f"{status or 'no status'}) names no service."})
            continue

        if status.lower() not in statuses or when is None:
            continue

        for service in services:
            if service.upper() not in known_services:
                unmapped[service] = unmapped.get(service, 0) + 1
            ym = (when.year, when.month)
            seen = collapse.get((key, service.upper(), ym), 0)
            collapse[(key, service.upper(), ym)] = seen + 1
            if seen:
                # Same client, same service, same month: the plan cannot hold
                # the second one (a consult has no day), and the loader keys a
                # ClientPackage on (package, client, start). Counted below.
                continue
            p["consults"].append({
                "code": service.upper(),
                "month": MONTH_NAMES[when.month - 1],
                "year": str(when.year),
                "raw": f"{service} on {_pretty(when)}",
            })

    for key, p in people.items():
        lines = [line for _, line in sorted(diary[key], key=lambda t: t[0])]
        p["notes"].extend(lines)
        if last_field and dates[key]["last"]:
            p["customFields"][last_field] = dates[key]["last"].isoformat()
        if next_field and dates[key]["next"]:
            p["customFields"][next_field] = dates[key]["next"].isoformat()
        frag["people"].append(p)

    _report(frag, path, people, rows, collapse, unmapped, businesses, statuses,
            staff_names)
    return [frag]


# ---------------------------------------------------------------------------
# Pieces
# ---------------------------------------------------------------------------

#: "Taniya & Jason Tubby" — two first names sharing one surname.
COUPLE_RE = re.compile(
    r"^(?P<a>[^\s&]+)\s*(?:&|\+|\band\b)\s*(?P<b>[^\s&]+)\s+(?P<last>.+)$",
    re.IGNORECASE)


def _tidy_name(name: str, p: dict, frag: dict) -> str:
    """
    Two things MoeGo's name field does that must not reach the database as-is.

    A blank surname: the front desk types '?', and 'Karen ?' imported verbatim
    is a client called Karen Questionmark.

    A couple on one account: 'Taniya & Jason Tubby' is one household with one
    surname, but the generic first-word/rest split reads the surname as
    '& Jason Tubby'. Splitting it here is not a guess — the shape is
    unambiguous — and the partner is written to the notes rather than dropped,
    because the second name is the only record that they exist.
    """
    raw = parsing.clean(name)
    cleaned = re.sub(r"\s*[?]+\s*$", "", raw).strip()
    if cleaned != raw:
        frag["needsReview"].append({
            "kind": "Client has no surname", "who": cleaned,
            "detail": f"MoeGo has this client as {raw!r} — the surname was "
                      f"never filled in. Imported as '{cleaned}'."})

    couple = COUPLE_RE.match(cleaned)
    if couple:
        first, partner, last = (couple.group("a"), couple.group("b"),
                                couple.group("last"))
        p["firstName"] = first
        p["lastName"] = last
        p["notes"].append(f"MoeGo account is in two names: "
                          f"{first} and {partner} {last}.")
        frag["needsReview"].append({
            "kind": "Two people on one account", "who": cleaned,
            "detail": f"'{cleaned}' is a household, not a person. Imported as "
                      f"{first} {last}; {partner} {last} is named in the "
                      f"notes. One login, as MoeGo had it."})
    return cleaned or raw


def _add_pets(p: dict, row: dict, frag: dict, source_row: str) -> None:
    """
    Pet name and Pet breed look like parallel lists. THEY ARE NOT ALIGNED.

    Verified against the same salon's client export, which records a breed per
    pet and so cannot be ambiguous:

        appointment row   Luna,Ronin   /  Border Collie,Cavapoo (h)
        client export     Ronin(Border Collie) … Luna(Cavapoo (h))

        appointment row   Choppa,Rocket /  Shih Tzu,Shichon (h)
        client export     Choppa(Shichon (h)) … Rocket(Shih Tzu)

    Both reversed. MoeGo builds the two cells from different queries and
    nothing keeps their order in step, so zipping them by index produces a
    confident, wrong breed on every dog of a multi-pet appointment — and a
    wrong breed reads exactly like a right one.

    So a breed is taken ONLY when the row books a single pet, where there is
    nothing to mispair. Otherwise the raw list goes on the dogs' notes and the
    breed is left for the client export to supply.
    """
    names = _split(row.get("petName"))
    breeds = _split(row.get("petBreed"))
    kind = parsing.clean(row.get("petType"))
    owner = p["name"]

    if not names:
        return

    paired = len(names) == 1 and len(breeds) == 1
    if breeds and not paired:
        frag["needsReview"].append({
            "kind": "Cannot tell which pet is which breed", "who": owner,
            "detail": f"{source_row} books {len(names)} pets "
                      f"({', '.join(names)}) and lists breeds "
                      f"({', '.join(breeds)}) in an order MoeGo does not keep "
                      f"aligned with the names. No breed was assigned; the raw "
                      f"list is on the dogs' notes."})

    for i, dog_name in enumerate(names):
        breed = breeds[i] if paired else ""

        if not re.search(r"[^\W_]", dog_name, re.UNICODE):
            # A pet named '?' — MoeGo requires a pet, the front desk did not
            # know the name. The dog-name judge calls this "empty" and an
            # empty cell is not logged, so it would vanish without trace: the
            # owner would import with no dog and nothing would say why. The
            # dog is real, so what we know about it is written down.
            frag["needsReview"].append({
                "kind": "Pet with no name", "who": owner,
                "detail": f"{source_row} books a pet whose name in MoeGo is "
                          f"{dog_name!r}"
                          + (f" (breed: {', '.join(breeds)})" if breeds else "")
                          + f". No dog was created for {owner} — ask what it "
                            f"is called."})
            p["notes"].append(
                f"Has a pet MoeGo records only as {dog_name!r}"
                + (f", breed {', '.join(breeds)}" if breeds else "")
                + " — name unknown, so no dog record was created.")
            continue

        note = "" if paired else (f"MoeGo breed for this appointment: "
                                  f"{', '.join(breeds)}" if breeds else "")
        if kind and kind.lower() not in ("dog", ""):
            # PupManager has dogs, not pets. A cat still belongs to a real
            # client with a real grooming history, so it is imported — clearly
            # marked, and listed for a human.
            note = f"{kind} (not a dog){' — ' + note if note else ''}"
            frag["needsReview"].append({
                "kind": f"{kind}, not a dog", "who": owner,
                "detail": f"{dog_name} is a {kind.lower()} in MoeGo. "
                          f"PupManager only models dogs, so {dog_name} was "
                          f"imported as one with a note saying otherwise."})
        existing = next((d for d in p["dogs"]
                         if parsing.norm_name(d["name"])
                         == parsing.norm_name(dog_name)), None)
        if existing:
            if breed and not existing.get("breed"):
                existing["breed"] = breed
            continue
        # requireName: a pet cell the judge refuses ('Misc.') tells us nothing
        # about a dog, so no dog is created — the refusal is recorded in
        # junkDogNameOverrides and the owner still imports. Without this the
        # person gets a dog with an empty name, which is worse than none.
        p["dogs"].append({"name": dog_name, "breed": breed, "note": note,
                          "judge": True, "where": source_row,
                          "requireName": True})


def _diary_line(row: dict, when: date | None, services: list[str],
                add_ons: list[str], status: str) -> str:
    """One appointment as one readable line. This is where the exact date and
    the money survive, since a consult record can hold neither."""
    bits = [_pretty(when) if when else parsing.clean(row.get("date")) or "date unknown"]
    what = ", ".join(services) or "no service recorded"
    pets = ", ".join(_split(row.get("petName")))
    bits.append(f"{what}{f' for {pets}' if pets else ''}")
    if add_ons:
        bits.append("plus " + ", ".join(add_ons))
    tail = [b for b in (status, parsing.clean(row.get("paymentStatus")),
                        _money(row.get("gross"))) if b]
    if tail:
        bits.append(" / ".join(tail))
    return "Appointment: " + " — ".join(bits)


def _report(frag: dict, path: Path, people: dict, rows: list,
            collapse: dict, unmapped: dict, businesses: set,
            statuses: set, staff_names: set) -> None:
    """The things a human should know about this file before loading it."""
    # A salon books its own ad-hoc work against a client record named after
    # the groomer — a house account, not a customer. It is a real MoeGo record
    # and gets imported, but importing the business owner as one of her own
    # clients is exactly the kind of thing nobody notices for a year.
    staff_keys = {parsing.norm_name(s) for s in staff_names}
    for p in frag["people"]:
        if parsing.norm_name(p["name"]) in staff_keys:
            frag["needsReview"].append({
                "kind": "Client has a staff member's name", "who": p["name"],
                "detail": f"'{p['name']}' is also a groomer in this report, so "
                          f"this is probably a house account for walk-in work "
                          f"rather than a customer. Imported as a client — "
                          f"delete it if that is what it is."})

    dropped = sum(n - 1 for n in collapse.values() if n > 1)
    if dropped:
        frag["needsReview"].append({
            "kind": "Repeat appointments in one month", "who": "",
            "detail": f"{dropped} appointment(s) were a repeat of the same "
                      f"service for the same client in the same calendar "
                      f"month. A service record carries a month and no day, "
                      f"so only the first became one. Every date is in the "
                      f"person's notes."})

    for service, n in sorted(unmapped.items()):
        frag["needsReview"].append({
            "kind": "Service is not in the client config", "who": "",
            "detail": f"'{service}' appears {n} time(s) but is not in "
                      f"serviceNames, so it imports under the generic "
                      f"'1:1 / in-home service' name. Add it to the config."})

    real = {p["name"] for p in frag["people"] if not p.get("email")}
    if real:
        frag["needsReview"].append({
            "kind": "No contact details in this file", "who": "",
            "detail": f"{len(real)} client(s) came from {path.name}, which "
                      f"carries no email, phone or address column — MoeGo "
                      f"omits them unless they are switched on before "
                      f"downloading. Every one of them gets a placeholder "
                      f"address and can never be merged with a later record "
                      f"automatically. A Client & Pet List export with the "
                      f"contact columns enabled fixes this."})

    named = sorted(b for b in businesses if b)
    if len(named) > 1:
        frag["needsReview"].append({
            "kind": "More than one business in one report", "who": "",
            "detail": "This report covers " + ", ".join(named) +
                      ". Every appointment was imported to the one trainer."})

    frag["needsReview"].append({
        "kind": "What this report covers", "who": "",
        "detail": f"{len(rows)} appointment(s) for {len(people)} client(s), "
                  f"from {path.name}. Only appointments with status "
                  f"{'/'.join(sorted(statuses))} became service records; the "
                  f"rest are in the notes. Anyone who did not book inside the "
                  f"report's date range is not in this import at all."})
