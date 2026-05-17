import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ─── Timezone-aware date/time formatting ─────────────────────────────────────
// EVERYTHING a trainer sees must render in their configured timezone
// (User.timezone), NOT the device/runtime tz — otherwise the same
// timestamp shows differently on an iPad vs a computer in another tz,
// and as UTC on the server. Always pass `tz`. The optional signature is
// only for the few genuinely tz-agnostic spots; new code passes it.
// These are pure Intl so they work client- and server-side.

export function formatDate(date: Date | string, tz?: string): string {
  return new Intl.DateTimeFormat('en-NZ', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: tz,
  }).format(new Date(date))
}

export function formatTime(date: Date | string, tz?: string): string {
  return new Intl.DateTimeFormat('en-NZ', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: tz,
  }).format(new Date(date))
}

export function formatDateTime(date: Date | string, tz?: string): string {
  return new Intl.DateTimeFormat('en-NZ', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: tz,
  }).format(new Date(date))
}

/** Calendar-grade date parts for an instant, in the given timezone. */
export function dateParts(
  date: Date | string,
  tz: string,
): { year: number; month: number; day: number; hour: number; minute: number; weekday: number } {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(new Date(date))
  const g: Record<string, string> = {}
  for (const x of p) if (x.type !== 'literal') g[x.type] = x.value
  const wmap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return {
    year: Number(g.year),
    month: Number(g.month),
    day: Number(g.day),
    hour: Number(g.hour),
    minute: Number(g.minute),
    weekday: wmap[g.weekday] ?? 0,
  }
}

/** 'YYYY-MM-DD' for an instant in the given timezone (date bucketing). */
export function ymdInTz(date: Date | string, tz: string): string {
  const { year, month, day } = dateParts(date, tz)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Minutes since local midnight in `tz` — for calendar vertical position. */
export function minutesIntoDayInTz(date: Date | string, tz: string): number {
  const { hour, minute } = dateParts(date, tz)
  return hour * 60 + minute
}

// Strip the redundant "— session 1/1" suffix from package-generated session
// titles. Earlier package assignments wrote that suffix unconditionally; the
// API now omits it for single-session packages, but legacy rows still carry
// it. Multi-session forms ("— session 2/3") are preserved so the trainer can
// see progression at a glance.
//
// Two variants get stripped:
//   • "— session 1/1" (legacy single-session counter)
//   • "— session" (bare suffix with no counter at all — also adds no info)
// "— session 2/3" and higher are kept because the count is meaningful.
export function formatSessionTitle(title: string): string {
  return title.replace(/\s*[—-]\s*session(\s+1\s*\/\s*1)?\s*$/i, '')
}

export function getInitials(name: string): string {
  return name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}
