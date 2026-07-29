/**
 * The auto-award rules a trainer can pick from, and how each one reads back to
 * them. Shared by the list (which prints the rule under each badge) and the
 * form (which offers the picker), so the two can't describe the same trigger
 * two different ways.
 *
 * Kept in step with TRIGGER_TYPES / TRIGGERS_NEEDING_VALUE in the achievements
 * API routes — a unit test asserts the three lists agree.
 */

export type TriggerType =
  | 'MANUAL'
  | 'FIRST_SESSION'
  | 'SESSIONS_COMPLETED'
  | 'IN_PERSON_SESSIONS'
  | 'VIRTUAL_SESSIONS'
  | 'CONSECUTIVE_SESSIONS_ATTENDED'
  | 'FIRST_PACKAGE_ASSIGNED'
  | 'PACKAGES_COMPLETED'
  | 'FIRST_HOMEWORK_DONE'
  | 'HOMEWORK_TASKS_DONE'
  | 'HOMEWORK_STREAK_DAYS'
  | 'PERFECT_WEEK'
  | 'CLIENT_ANNIVERSARY_DAYS'
  | 'MESSAGES_SENT'
  | 'PRODUCTS_PURCHASED'
  | 'PROFILE_COMPLETED'

export interface TriggerMeta {
  type: TriggerType
  label: string
  group: 'Sessions' | '1:1 Sessions' | 'Homework' | 'Other' | 'Manual'
  needsValue: boolean
  valueLabel?: string
  preview: (n: number) => string
}

export const TRIGGERS: TriggerMeta[] = [
  { type: 'MANUAL', label: 'Manual — team awards', group: 'Manual', needsValue: false, preview: () => 'Awarded by hand from the client profile' },
  { type: 'FIRST_SESSION', label: 'First session attended', group: 'Sessions', needsValue: false, preview: () => 'Awarded after the first completed session' },
  { type: 'SESSIONS_COMPLETED', label: 'Total sessions completed', group: 'Sessions', needsValue: true, valueLabel: 'Sessions', preview: n => `Awarded after ${n} completed session${n === 1 ? '' : 's'}` },
  { type: 'IN_PERSON_SESSIONS', label: 'In-person sessions completed', group: 'Sessions', needsValue: true, valueLabel: 'Sessions', preview: n => `Awarded after ${n} in-person session${n === 1 ? '' : 's'}` },
  { type: 'VIRTUAL_SESSIONS', label: 'Virtual sessions completed', group: 'Sessions', needsValue: true, valueLabel: 'Sessions', preview: n => `Awarded after ${n} virtual session${n === 1 ? '' : 's'}` },
  { type: 'CONSECUTIVE_SESSIONS_ATTENDED', label: 'Consecutive sessions attended', group: 'Sessions', needsValue: true, valueLabel: 'In a row', preview: n => `Awarded for ${n} sessions attended in a row` },
  // "Package" is the bundled offering now, so these two — which fire off a 1:1
  // assignment — read as consults. The trigger TYPES stay as they are: they're
  // stored on every existing achievement row.
  { type: 'FIRST_PACKAGE_ASSIGNED', label: 'First 1:1 session signed up', group: '1:1 Sessions', needsValue: false, preview: () => 'Awarded when the first 1:1 session is assigned' },
  { type: 'PACKAGES_COMPLETED', label: '1:1 Sessions completed', group: '1:1 Sessions', needsValue: true, valueLabel: '1:1 Sessions', preview: n => `Awarded after ${n} completed 1:1 session${n === 1 ? '' : 's'}` },
  { type: 'FIRST_HOMEWORK_DONE', label: 'First homework done', group: 'Homework', needsValue: false, preview: () => 'Awarded the first time a homework task is completed' },
  { type: 'HOMEWORK_TASKS_DONE', label: 'Homework tasks done', group: 'Homework', needsValue: true, valueLabel: 'Tasks', preview: n => `Awarded after ${n} completed task${n === 1 ? '' : 's'}` },
  { type: 'HOMEWORK_STREAK_DAYS', label: 'Homework streak (days)', group: 'Homework', needsValue: true, valueLabel: 'Days in a row', preview: n => `Awarded for ${n} day${n === 1 ? '' : 's'} of perfect homework in a row` },
  { type: 'PERFECT_WEEK', label: 'Perfect weeks', group: 'Homework', needsValue: true, valueLabel: 'Weeks', preview: n => `Awarded after ${n} week${n === 1 ? '' : 's'} where every task was completed` },
  { type: 'CLIENT_ANNIVERSARY_DAYS', label: 'Client anniversary', group: 'Other', needsValue: true, valueLabel: 'Days as a client', preview: n => `Awarded after ${n} day${n === 1 ? '' : 's'} on the books` },
  { type: 'MESSAGES_SENT', label: 'Messages sent', group: 'Other', needsValue: true, valueLabel: 'Messages', preview: n => `Awarded after the client sends ${n} message${n === 1 ? '' : 's'}` },
  { type: 'PRODUCTS_PURCHASED', label: 'Products purchased', group: 'Other', needsValue: true, valueLabel: 'Products', preview: n => `Awarded after ${n} product purchase${n === 1 ? '' : 's'}` },
  { type: 'PROFILE_COMPLETED', label: 'Profile fully completed', group: 'Other', needsValue: false, preview: () => 'Awarded once every required custom field has a value' },
]

export const TRIGGER_META = Object.fromEntries(
  TRIGGERS.map(t => [t.type, t])
) as Record<TriggerType, TriggerMeta>

export const TRIGGER_GROUPS = ['Sessions', '1:1 Sessions', 'Homework', 'Other'] as const

/** The colour keys a badge can be tinted with. */
export type Color = 'blue' | 'emerald' | 'amber' | 'rose' | 'violet' | 'sky' | 'orange' | 'teal' | 'pink' | 'slate'

export const COLORS: { key: Color; bgChip: string; ring: string; text: string }[] = [
  { key: 'blue',    bgChip: 'bg-blue-100 text-blue-600',       ring: 'ring-blue-200',    text: 'text-blue-700' },
  { key: 'emerald', bgChip: 'bg-emerald-100 text-emerald-600', ring: 'ring-emerald-200', text: 'text-emerald-700' },
  { key: 'amber',   bgChip: 'bg-amber-100 text-amber-600',     ring: 'ring-amber-200',   text: 'text-amber-700' },
  { key: 'rose',    bgChip: 'bg-rose-100 text-rose-600',       ring: 'ring-rose-200',    text: 'text-rose-700' },
  { key: 'violet',  bgChip: 'bg-violet-100 text-violet-600',   ring: 'ring-violet-200',  text: 'text-violet-700' },
  { key: 'sky',     bgChip: 'bg-sky-100 text-sky-600',         ring: 'ring-sky-200',     text: 'text-sky-700' },
  { key: 'orange',  bgChip: 'bg-orange-100 text-orange-600',   ring: 'ring-orange-200',  text: 'text-orange-700' },
  { key: 'teal',    bgChip: 'bg-teal-100 text-teal-600',       ring: 'ring-teal-200',    text: 'text-teal-700' },
  { key: 'pink',    bgChip: 'bg-pink-100 text-pink-600',       ring: 'ring-pink-200',    text: 'text-pink-700' },
  { key: 'slate',   bgChip: 'bg-slate-200 text-slate-600',     ring: 'ring-slate-200',   text: 'text-slate-700' },
]

export const COLOR_BY_KEY = Object.fromEntries(
  COLORS.map(c => [c.key, c])
) as Record<Color, typeof COLORS[number]>

export const DEFAULT_COLOR: Color = 'amber'

export const COMMON_ICONS = ['🏆', '⭐', '🥇', '🎖️', '🐾', '🦴', '💯', '🚀', '🔥', '🎯', '🌟', '👑']

export interface AchievementRecord {
  id: string
  name: string
  description: string | null
  icon: string | null
  imageUrl: string | null
  color: string | null
  published: boolean
  triggerType: TriggerType
  triggerValue: number | null
}

/** The one-line "how is this earned" a card prints under the name. */
export function triggerLine(a: Pick<AchievementRecord, 'triggerType' | 'triggerValue'>): string {
  if (a.triggerType === 'MANUAL') return 'Manual'
  return TRIGGER_META[a.triggerType]?.preview(a.triggerValue ?? 1) ?? 'Auto'
}
