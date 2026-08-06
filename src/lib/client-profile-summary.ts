// The second line on every tile of a client's profile grid.
//
// The grid used to be nine bare labels — a menu with not one fact about the
// client on it (Karl, 2026-08-06: "this is way too intense from a ux
// perspective"). Each tile now carries its own number or state, which is what
// turns a menu into a summary.
//
// Two rules govern everything in here, and they are why this is a module of
// pure functions rather than a handful of inline ternaries:
//
//   1. **It must be true.** A wrong count on a client's screen is worse than no
//      count. Where the page only loaded a capped slice (the practice log is
//      `take: 30`), the label says "30+" rather than quoting the cap as a total.
//   2. **Zero reads as words.** "No sessions yet", not "0". A grid of zeroes on
//      a brand-new client is bleaker than the menu it replaced.
//
// Pure and dependency-free so both the client component and a unit test can
// call them, and so a test can pin `now` instead of racing the clock.

/** "Thu 10:00 am" inside a week, "12 Aug, 10:00 am" beyond it. */
function whenLabel(iso: string, now: Date): string {
  const d = new Date(iso)
  const time = new Intl.DateTimeFormat('en-NZ', { hour: 'numeric', minute: '2-digit' }).format(d)
  const withinAWeek = Math.abs(d.getTime() - now.getTime()) < 7 * 24 * 60 * 60 * 1000
  if (withinAWeek) {
    const weekday = new Intl.DateTimeFormat('en-NZ', { weekday: 'short' }).format(d)
    return `${weekday} ${time}`
  }
  const date = new Intl.DateTimeFormat('en-NZ', { day: 'numeric', month: 'short' }).format(d)
  return `${date}, ${time}`
}

function dayLabel(iso: string): string {
  return new Intl.DateTimeFormat('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso))
}

/**
 * Sessions: when the next one is. Failing that, when the last one was — a
 * client with a history and nothing booked is a different situation from a
 * client who has never had a session, and the tile should not flatten the two.
 */
export function nextSessionLine(sessions: { scheduledAt: string }[], now: Date): string {
  const t = now.getTime()
  const upcoming = sessions
    .filter(s => new Date(s.scheduledAt).getTime() >= t)
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())[0]
  if (upcoming) return whenLabel(upcoming.scheduledAt, now)

  const past = sessions
    .filter(s => new Date(s.scheduledAt).getTime() < t)
    .sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime())[0]
  if (past) return `Last ${dayLabel(past.scheduledAt)}`

  return 'No sessions yet'
}

/**
 * How long ago something happened, in the words a person uses. Used by the
 * Comms tile, whose list is capped at 60 — the NEWEST entry is still exact,
 * which is why this tile quotes a date and not a total.
 */
export function agoLine(iso: string | null, now: Date, empty: string): string {
  if (!iso) return empty
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return empty
  const days = Math.floor((startOfDay(now) - startOfDay(then)) / 86_400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  if (days < 14) return 'Last week'
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`
  return dayLabel(iso)
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/**
 * "4 entries" / "1 entry" / the worded zero. `cap` is the page's `take` — hit
 * it and the label says "30+", because at that point the number loaded is a
 * floor, not a total.
 */
export function countLine(
  n: number,
  singular: string,
  plural: string,
  empty: string,
  cap?: number,
): string {
  if (n <= 0) return empty
  if (cap != null && n >= cap) return `${cap}+ ${plural}`
  return `${n} ${n === 1 ? singular : plural}`
}

/** "Sammy · Cockapoo" for one, "Sammy, Bella · 2 dogs" for more. */
export function dogsLine(dogs: { name: string; breed: string | null }[]): string {
  if (dogs.length === 0) return 'No dog added'
  if (dogs.length === 1) {
    const [d] = dogs
    return d.breed ? `${d.name} · ${d.breed}` : d.name
  }
  return `${dogs.map(d => d.name).join(', ')} · ${dogs.length} dogs`
}

/**
 * The Dog tile's line.
 *
 * NOT the dog's name — the hero directly above it already carries that (and on
 * desktop the summary card in the aside does), and a name repeated 40px below
 * itself is the "nothing says the same thing twice" rule broken in the most
 * visible place on the screen. Age is the fact a trainer wants and the one
 * nothing else on the profile surfaces at a glance.
 */
export function dogsTileLine(
  dogs: { dob: string | null; deceasedAt: string | null }[],
  now: Date,
): string {
  if (dogs.length === 0) return 'No dog added'
  if (dogs.length > 1) return `${dogs.length} on file`
  const [d] = dogs
  if (d.deceasedAt) return 'Passed away'
  if (!d.dob) return 'No age on file'
  return ageLine(d.dob, now)
}

function ageLine(dob: string, now: Date): string {
  const born = new Date(dob)
  if (Number.isNaN(born.getTime())) return 'No age on file'
  let months = (now.getFullYear() - born.getFullYear()) * 12 + (now.getMonth() - born.getMonth())
  if (now.getDate() < born.getDate()) months -= 1
  if (months < 0) return 'No age on file'
  if (months < 24) return `${months} month${months === 1 ? '' : 's'} old`
  const years = Math.floor(months / 12)
  return `${years} years old`
}

export interface OwingSummary {
  /** Total still outstanding across UNPAID + PARTIAL invoices, in minor units. */
  owingCents: number
  /** The single currency they share, or null when they disagree. */
  currency: string | null
  count: number
}

/**
 * "$80.00 owing" / "Nothing owing".
 *
 * Mixed currencies fall back to a count. Summing two currencies into one number
 * would be a lie, and this is the one tile where a wrong number is money.
 */
export function owingLine(
  summary: OwingSummary,
  format: (minor: number, currency: string) => string,
): string {
  if (summary.count === 0 || summary.owingCents <= 0) return 'Nothing owing'
  if (!summary.currency) return countLine(summary.count, 'unpaid', 'unpaid', 'Nothing owing')
  return `${format(summary.owingCents, summary.currency)} owing`
}

/** A one-line taste of the trainer's private note, or the worded zero. */
export function notesLine(plain: string | null | undefined): string {
  const text = (plain ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return 'No notes yet'
  return text.length > 60 ? `${text.slice(0, 59).trimEnd()}…` : text
}
