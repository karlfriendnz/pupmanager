# Client data import — the extract & review half

Onboarding a client means taking whatever files they have — a spreadsheet kept
for eight years, a contacts export, a mailing list, a hand-typed list of
referral partners — and turning it into records in PupManager without losing
anything and without inventing anything.

This half does the first part: **read the files, merge them into one plan, and
make the plan reviewable by a human.** It never touches a database and never
reaches the network (stdlib + `openpyxl`, nothing else). The load half —
`README.md`, `import-client.ts`, `loader/` — reads the plan this produces.

That split is the whole design. An import is irreversible in practice: once a
client's records are live, nobody unpicks a bad merge by hand. So the pipeline
stops, deliberately, at a file somebody can read and argue with.

```
raw files ──► build_plan.py ──► plan.json ──► review.py ──► xlsx + html + csv
                                    │                            │
                                    │                            └─► a human says
                                    │                                "no, that's
                                    │                                 not her dog"
                                    └────────────────────► import-client.ts (the load half)
```

---

## Running it

```bash
# 1. build the plan
python3 scripts/import/build_plan.py scripts/import/clients/journey.json \
        -o ~/Desktop/Temp/journey_plan.json

# 2. render it for review
python3 scripts/import/review.py ~/Desktop/Temp/journey_plan.json \
        ~/Desktop/Temp/journey_review

# check the inputs resolve without reading them
python3 scripts/import/build_plan.py scripts/import/clients/journey.json --check-only
```

Exit codes: `0` fine · `1` a config/input problem, nothing written · `2` the
plan was written but failed validation — **do not load it**.

---

## The two layers

**Layer 1 — code.** How messy data behaves. Column orders that shift mid-file,
phone numbers written six ways, a notes blob with twenty years of history in
it, two people sharing one email address. The same for every client; lives in
`lib/` and `sources/`.

**Layer 2 — config.** What one client's shorthand means. "SP" is School Pups.
"Allsorts" was the previous trainer. The spreadsheet beats the contacts
export. One JSON file in `clients/`.

The measure of whether the split worked is how small layer 2 is — see
[Onboarding a new client](#onboarding-a-new-client).

```
build_plan.py              CLI: read the files, write plan.json
review.py                  CLI: plan.json -> xlsx + html + csv

lib/parsing.py             façade — one import for everything below
   text.py                 normalisation; "do these two values agree?"
   classify.py             what a cell IS, by content, never by position
   notes.py                the multi-line notes blob -> structured facts
   dedup.py                identity, placeholder addresses, junk filters
lib/people.py              the person registry, field precedence, dog merging
lib/courses.py             the class catalogue: match, invent, enrol
lib/dogs.py                the dog-name judge
lib/config.py              per-client vocabulary, loaded from JSON
lib/merge.py               fragments -> one plan (every decision lives here)
lib/plan_schema.py         the plan's shape, written down, + validate()
lib/render.py              xlsx + csv
lib/html_view.py           the self-contained offline review page

sources/booking_spreadsheet.py    multi-sheet course-intake workbook
sources/outlook_contacts.py       contacts export with a notes blob
sources/squarespace_profiles.py   website / mailing-list export
sources/simple_contacts.py        flat Name / Phone / Business / Email list
sources/doggie_dashboard.py         DoggieDashboard owner export (CSV)
sources/doggie_dashboard_reports.py DoggieDashboard printed reports (PDF)
sources/_pdf.py                     text out of a PDF, stdlib only

clients/journey.json       the worked example (classes)
clients/dukes.json         the worked example (daycare)

build_daycare.py           CLI: the day-parts + bookings plan.json cannot carry
```

`scripts/prime/` is the original one-off built for Journey Dog Training. It is
left untouched on purpose, as the worked example this was generalised from.

---

## The rules that matter

Every one of these was learned by getting it wrong on real data.

**Classify cells by content, never by column position.** One sheet in the
first client's workbook changed column order half way down — the trainer
inserted three columns around row 142 and kept typing. An importer that trusts
"column D is the phone" produces confident garbage for the second half of the
file, and nobody notices until a client gets someone else's text message.

**Test for a date before you test for a phone number.** `13/12/24` and
`0211306127` are both digit-and-separator soup. Get the order wrong and every
booking date in the file becomes a mobile number.

**An empty value is a gap, not a disagreement.** It never conflicts, never
overrides, never appears in the conflict list. That single rule is what keeps
the review down to the dozen decisions a human genuinely has to make.

**A record with no email address never merges with anyone.** It gets an
invented placeholder that cannot collide. If a same-named person already
exists we say so, loudly, in the review — "probably the same person" is the
client's judgement, not ours.

**A placeholder is not evidence.** A real address beats one, from any file,
and losing that fight is not recorded as a conflict.

**Nothing is silently dropped.** Note lines no rule could classify land in the
person's notes. Dog-name cells that turned out to hold "Pulled out" are
written back onto the person *and* listed in `08_junk_dog_names.csv`.
Spreadsheet rows with no way to contact anybody go to `needsReview` rather
than being imported as contactless records.

**No silent overwrite.** Every discarded value is recorded with both sources —
"kept 021…, set aside 027… (spreadsheet beats contacts)" — so the person who
knows which number still works can review it.

**Determinism.** Two runs on the same inputs produce byte-identical output.
Placeholder addresses are hashes of stable seeds, person ids are allocated in
file order, nothing iterates a set. That is what makes `diff` between two runs
mean "my config change did what I intended" rather than nothing at all.

---

## Two orderings, deliberately separate

`files` is the order files are **processed**. The first is the spine — usually
the client's own operating spreadsheet, the file with the history in it. Every
later file matches into what the spine created.

`priorities` is who **wins a field-level disagreement**. The contacts export
is read third but must never overwrite a phone number the spreadsheet had.

Conflating them is a bug waiting to happen, so they are two config keys.

---

## How a source module works

A *shape* is a kind of file we have met before — not a particular client's
file. `outlook_contacts` is a shape; Journey's `contacts.csv` is an instance.

Each module in `sources/` exposes three things:

```python
SHAPE = "outlook_contacts"

def vocabulary(path, options) -> {"breeds": [...], "suburbs": {...}}
    # A cheap first pass: what this file can teach LATER files about the
    # words this client uses. May be empty.

def extract(path, options, ctx) -> [fragment, ...]
    # The real read. One file may emit several fragments when it holds
    # several kinds of evidence — the booking spreadsheet emits its class
    # sheets and its waitlist separately, because they are not equally
    # reliable.
```

A **fragment is one file's opinion** of some people — never a merged view.
`lib/merge.py` is the only thing allowed to reconcile opinions, which is what
lets a new shape be written without understanding precedence at all.

The vocabulary pass exists because classification needs the client's own
words: deciding whether `Teddy - Yorkshire Terrier` in a notes blob is a dog
needs to know what this client's breeds look like, and that is learned from
the spreadsheet's breed column. **Both passes get identical options** — a
source that reads its file differently in the two passes teaches from one
reading and parses with another, which is a genuinely nasty bug to find.

A fragment can also declare how it wants to be treated:

| flag | meaning |
|---|---|
| `selfDeduped` | this source already resolved its own duplicates; two of its records are two people whatever they are called |
| `scanNotesForRoles` | its notes mark helpers in prose ("B:Volunteer") |
| `announceNameMatch` | is a name-only match worth a review note? True for a foreign file; False for a second sheet of the *same* document, where a name match is the expected outcome |
| `messages` | per-shape wording for the review notes, so the workbook reads like it was written about *this* file |

and per person: `neverMerge`, `claimsExclusive`, `requireCompatibleName`,
`allowNameMatch`.

---

## Onboarding a new client

1. **Look at the files.** Which of the four shapes is each one? If none fit,
   write a new module in `sources/` — about 150 lines, and it needs to know
   nothing about merging.

2. **Copy `clients/journey.json`** and change:

   | key | what it says |
   |---|---|
   | `files` | which file is which shape, in processing order (spine first), plus any column-name overrides in `options` |
   | `priorities` | who wins a field-level disagreement |
   | `courseCodes` | their shorthand for a class level, and what it means. Omit if they do not run classes |
   | `serviceNames` / `servicePhrases` | their 1:1 work — these become consults, never class enrolments |
   | `priorProviders` | the previous trainer's name, if their notes reference classes somebody else ran |
   | `customFields` | their labels for volunteer / professional / previous trainer / business / credit. `""` switches one off |
   | `placeholderNamespace` | anything unique, so two clients' invented addresses can never collide. **Pin it and never change it** — the load half recognises a re-run by these addresses |
   | `suburbs`, `breedWords` | local place names and breed vocabulary. Optional; the client's own data extends both automatically |
   | `phone` | only if they are not in New Zealand |
   | `csv` | `companyTo` (which custom column a person's company fills) and `oncePerPerson` (custom columns written on the first dog row only) |

3. **Run `--check-only`**, then build, then read the warnings. A warning is
   usually the data being true and strange, not a bug.

4. **Render the review and give it to someone who knows the business.** The
   HTML page is the one they will actually open.

Everything else — matching, precedence, dog merging, class invention,
placeholder addresses, the workbook layout — comes for free.

### If the client is a daycare, not a class business

`plan.json` has two class-shaped concepts — a course (a cohort with a fixed
number of weekly sessions) and a 1:1 consult — and a daycare booking is
neither. PupManager does model daycare (`Package.isPuppySchool`, day-parts as
`PackageSessionSlot`, each booking a drop-in `ClassEnrollment`; see
`src/lib/run-kind.ts`), but none of it fits the canonical plan, so it has its
own small plan and its own loader alongside the main one:

```bash
python3 scripts/import/build_daycare.py clients/<slug>.json \
        --plan <plan.json> -o <daycare.json>

./node_modules/.bin/dotenv -e .env.development.local -o -- \
  npx tsx scripts/import/import-daycare.ts --env .env.development.local \
    --trainer <email> --daycare <daycare.json> [--dry-run]
```

It runs AFTER the main import and matches into the people it created — it
creates no people and no dogs, and reports every booking whose owner or dog it
could not find rather than inventing one.

**The week board buckets a day's cells by START time**, so two day-parts that
begin at the same minute cannot be told apart on it. `build_daycare.py`
therefore keys a slot on (weekday, start time) and records the rest of the
booking — half day vs full day, which group the dog is in — on the booking
itself. Moving a day-part to an invented start time so the grid could separate
them would be making data up to suit a screen.

---

## What is in a plan

Field-by-field documentation is the docstring of `lib/plan_schema.py`. Short
version:

```
meta        what was read, which rules applied, the counts, emailNamespace
people[]    the merged people — provenance, overrides and flags per field
courses[]   every class anyone referred to; origin "spreadsheet" or "invented"
subscribers[]     one row per mailing-list ROW, linked to a person
professionals[]   one row per role-list ROW, linked to a person
junkDogNameOverrides[]   every dog-name cell we refused, and why
fieldOverrides[]         every value set aside, and what beat it
needsReview[]            everything a human should look at before loading
```

`validate(plan)` checks structure, cross-references (an enrolment pointing at
a class that is not in the plan), rule violations (a placeholder that is not
shaped like one; two people on one real email) and silent-loss risks (a person
with no name who is not mentioned in `needsReview`). It reports everything at
once rather than failing fast: an onboarding is a batch job on a laptop, and
"here are all 40 problems" beats "here is the first one", forty times.

---

## Output

```
review.xlsx    one tab per kind of decision, frozen headers, autofilters
review.html    the same workbook as ONE self-contained offline page
csv/01_people_and_dogs.csv   shaped for the destination bulk-import wizard
csv/02..08                   courses, enrolments, consults, subscribers,
                             needs-review, overrides, junk dog names
```

The HTML page exists because there is no spreadsheet application on the
machine this runs on, and the content is real names, home addresses, phone
numbers and notes about people's children. It must never be pasted into a
hosted viewer to be read. One file, no network requests, no fonts, no
analytics.

**One header gotcha worth knowing:** the destination wizard's auto-mapper
sends any header containing *note* / *notes* / *comment* to the **dog's**
notes field. Person-level free text is therefore exported as **Background**.
Rename it and a decade of history about the owner silently lands on the dog.

---

## Reproducing the Journey one-off

`clients/journey.json` reproduces `scripts/prime/` exactly. Verified against
the original `import_plan.json`:

| | generalised | original |
|---|---|---|
| people | 685 | 685 |
| dogs | 574 | 574 |
| courses | 87 | 87 |
| enrolments | 564 | 564 |
| subscribers | 583 | 583 |
| 1:1 consults | 129 | 129 |

Every person's every field is identical, and seven of the eight CSVs are
byte-identical to the one-off's output. Two intentional differences:

* **one extra review note** — a professional who matched an existing client by
  name while carrying a different email address. The one-off's professionals
  branch was hand-written and never made that check; the generic engine makes
  it for every source.
* **two stale flags removed** — the one-off set "no email in any source" at the
  moment a placeholder was minted, so it survived onto people whose real
  address turned up in a later file. The flag is now judged once every file has
  been read.
