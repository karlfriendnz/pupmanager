'use client'

import { useState, useEffect, useCallback } from 'react'
import { Bell } from 'lucide-react'
import { NOTIFICATION_TYPES } from '@/lib/notification-types'
import type { NotificationChannel } from '@/generated/prisma'

const CLIENT_TYPES = Object.values(NOTIFICATION_TYPES).filter(m => m.audience === 'client')
const CHANNEL_LABEL: Record<string, string> = { PUSH: 'Push', EMAIL: 'Email', IN_APP: 'In-app' }
const LEAD_OPTIONS: { label: string; minutes: number | null }[] = [
  { label: 'Off', minutes: null },
  { label: '30 min before', minutes: 30 },
  { label: '1 hour before', minutes: 60 },
  { label: '2 hours before', minutes: 120 },
  { label: '1 day before', minutes: 24 * 60 },
]

type PrefRow = { type: string; channel: string; enabled: boolean; minutesBefore: number | null; dailyAtHour: number | null }

export function ClientNotificationSettings() {
  const [prefs, setPrefs] = useState<Map<string, PrefRow>>(new Map())
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch('/api/notification-preferences')
    if (!res.ok) { setLoaded(true); return }
    const data = await res.json()
    const m = new Map<string, PrefRow>()
    for (const r of (data.preferences ?? []) as PrefRow[]) m.set(`${r.type}:${r.channel}`, r)
    setPrefs(m)
    setLoaded(true)
  }, [])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load])

  const meta = (type: string) => NOTIFICATION_TYPES[type as keyof typeof NOTIFICATION_TYPES]
  const row = (type: string, channel: string): PrefRow => prefs.get(`${type}:${channel}`)
    ?? { type, channel, enabled: (meta(type).defaultChannels ?? meta(type).channels).includes(channel as NotificationChannel), minutesBefore: meta(type).defaults.minutesBefore ?? null, dailyAtHour: meta(type).defaults.dailyAtHour ?? null }

  async function save(type: string, channel: string, patch: Partial<PrefRow>) {
    const next = { ...row(type, channel), ...patch }
    setPrefs(p => new Map(p).set(`${type}:${channel}`, next))
    await fetch('/api/notification-preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, channel, enabled: next.enabled, minutesBefore: next.minutesBefore, dailyAtHour: next.dailyAtHour }),
    }).catch(() => {})
  }

  // Reminder timing applies across channels — write to every channel row so the
  // cron can read it from any of them.
  async function saveTimingAllChannels(type: string, patch: Partial<PrefRow>) {
    for (const ch of meta(type).channels) await save(type, ch, patch)
  }

  if (!loaded) return <p className="text-sm text-slate-400 py-4">Loading…</p>

  return (
    <section className="mt-10">
      <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900 mb-1"><Bell className="h-5 w-5 text-accent" /> Notifications</h2>
      <p className="text-sm text-slate-500 mb-4">Choose what you hear about and how. Turn anything off you don&apos;t want.</p>

      <div className="space-y-3">
        {CLIENT_TYPES.map(t => {
          const isReminder = t.type === 'CLIENT_SESSION_REMINDER'
          // For the reminder, read timing off the first channel row.
          const timingRow = isReminder ? row(t.type, t.channels[0]) : null
          return (
            <div key={t.type} className="rounded-2xl bg-white shadow-[0_2px_16px_rgba(15,31,36,0.05)] p-4">
              <p className="text-sm font-semibold text-slate-900">{t.label}</p>
              <p className="text-xs text-slate-400 mb-3">{t.description}</p>

              <div className="flex flex-wrap gap-2">
                {t.channels.map(ch => {
                  const r = row(t.type, ch)
                  return (
                    <button
                      key={ch}
                      type="button"
                      onClick={() => save(t.type, ch, { enabled: !r.enabled })}
                      className={`inline-flex items-center gap-1.5 rounded-full px-3 h-8 text-xs font-medium border transition-colors ${r.enabled ? 'border-accent bg-accent-soft text-accent' : 'border-slate-200 text-slate-400'}`}
                    >
                      <span className={`h-2 w-2 rounded-full ${r.enabled ? 'bg-accent' : 'bg-slate-300'}`} />
                      {CHANNEL_LABEL[ch] ?? ch}
                    </button>
                  )
                })}
              </div>

              {isReminder && timingRow && (
                <div className="mt-3 pt-3 border-t border-slate-100 flex flex-col gap-3">
                  <label className="flex items-center justify-between gap-2">
                    <span className="text-sm text-slate-700">Morning summary</span>
                    <input
                      type="checkbox"
                      checked={timingRow.dailyAtHour != null}
                      onChange={e => saveTimingAllChannels(t.type, { dailyAtHour: e.target.checked ? 8 : null })}
                      className="h-5 w-5 accent-[var(--accent)]"
                    />
                  </label>
                  <label className="flex items-center justify-between gap-2">
                    <span className="text-sm text-slate-700">Before each session</span>
                    <select
                      value={timingRow.minutesBefore ?? ''}
                      onChange={e => saveTimingAllChannels(t.type, { minutesBefore: e.target.value ? Number(e.target.value) : null })}
                      className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                    >
                      {LEAD_OPTIONS.map(o => <option key={o.label} value={o.minutes ?? ''}>{o.label}</option>)}
                    </select>
                  </label>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
