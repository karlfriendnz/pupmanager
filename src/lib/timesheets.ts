// Shared timesheet helpers: rate→amount math, week normalisation, money fmt.

// Line total in cents. Mirrors the session time-entry math (round to nearest
// cent). minutes is the duration source of truth; rateCents the hourly rate.
export function amountFor(minutes: number, rateCents: number | null | undefined): number {
  if (!rateCents || minutes <= 0) return 0
  return Math.round((minutes / 60) * rateCents)
}

export function hoursToMinutes(hours: number): number {
  return Math.round(hours * 60)
}

export function minutesToHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100
}

// Normalise any date to the Monday (UTC) of its week, time zeroed — the canonical
// weekStart. Stored as a DATE so it's tz-stable.
export function mondayOf(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const dow = x.getUTCDay() // 0 Sun … 6 Sat
  const diff = (dow + 6) % 7 // days since Monday
  x.setUTCDate(x.getUTCDate() - diff)
  return x
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  nzd: '$', aud: '$', usd: '$', cad: '$', gbp: '£', eur: '€',
}

// Format minor units (cents) for display, e.g. money(8050, 'nzd') → "$80.50".
export function money(minorUnits: number, currency: string | null | undefined): string {
  const cur = (currency ?? 'nzd').toLowerCase()
  const symbol = CURRENCY_SYMBOLS[cur] ?? ''
  const value = (minorUnits / 100).toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return symbol ? `${symbol}${value}` : `${value} ${cur.toUpperCase()}`
}
