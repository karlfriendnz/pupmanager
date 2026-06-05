'use client'

import { useState, useEffect, useCallback } from 'react'
import { Bell, Mail, Smartphone } from 'lucide-react'
import { NOTIFICATION_TYPES } from '@/lib/notification-types'
import type { NotificationChannel } from '@/generated/prisma'

const CLIENT_TYPES = Object.values(NOTIFICATION_TYPES).filter(m => m.audience === 'client')
const CHANNELS: { id: NotificationChannel; label: string; Icon: typeof Bell }[] = [
  { id: 'PUSH', label: 'Push', Icon: Smartphone },
  { id: 'EMAIL', label: 'Email', Icon: Mail },
  { id: 'IN_APP', label: 'In-app', Icon: Bell },
]
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

  // Check-all per channel column.
  const channelAllOn = (channel: string) => CLIENT_TYPES.every(t => row(t.type, channel).enabled)
  async function toggleColumn(channel: string) {
    const target = !channelAllOn(channel)
    for (const t of CLIENT_TYPES) await save(t.type, channel, { enabled: target })
  }

  // Reminder timing applies across channels — write to every channel row.
  const reminder = CLIENT_TYPES.find(t => t.type === 'CLIENT_SESSION_REMINDER')
  const timingRow = reminder ? row(reminder.type, reminder.channels[0]) : null
  async function saveTiming(patch: Partial<PrefRow>) {
    if (!reminder) return
    for (const ch of reminder.channels) await save(reminder.type, ch, patch)
  }

  if (!loaded) return <p className="text-sm text-slate-400 py-4">Loading…</p>

  return (
    <section>
      <p className="text-sm text-slate-500 mb-4 flex items-center gap-1.5"><Bell className="h-4 w-4 text-accent" /> Tap to choose what you hear about and how.</p>

      <div className="rounded-2xl bg-white shadow-[0_2px_16px_rgba(15,31,36,0.05)] overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="text-left px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Notify me</th>
              {CHANNELS.map(({ id, label, Icon }) => (
                <th key={id} className="px-1 py-2 w-[64px]">
                  <button type="button" onClick={() => toggleColumn(id)} className="flex flex-col items-center gap-1 w-full text-slate-500 hover:text-slate-700">
                    <Icon className="h-4 w-4" />
                    <span className="text-[11px] font-medium leading-none">{label}</span>
                    <input type="checkbox" readOnly checked={channelAllOn(id)} className="h-4 w-4 accent-[var(--accent)] pointer-events-none" />
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CLIENT_TYPES.map(t => (
              <tr key={t.type} className="border-t border-slate-50">
                <td className="px-3 py-3 align-top">
                  <p className="text-sm font-medium text-slate-900 leading-tight">{t.label}</p>
                  <p className="text-xs text-slate-400 leading-tight mt-0.5">{t.description}</p>
                </td>
                {CHANNELS.map(({ id }) => {
                  const r = row(t.type, id)
                  return (
                    <td key={id} className="px-1 py-3 text-center align-middle">
                      <input
                        type="checkbox"
                        checked={r.enabled}
                        onChange={() => save(t.type, id, { enabled: !r.enabled })}
                        aria-label={`${t.label} — ${id}`}
                        className="h-5 w-5 accent-[var(--accent)] cursor-pointer"
                      />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Reminder timing — only relevant to session reminders. */}
      {timingRow && (
        <div className="mt-4 rounded-2xl bg-white shadow-[0_2px_16px_rgba(15,31,36,0.05)] p-4">
          <p className="text-sm font-semibold text-slate-900 mb-3">Reminder timing</p>
          <label className="flex items-center justify-between gap-2 py-1">
            <span className="text-sm text-slate-700">Morning summary</span>
            <input
              type="checkbox"
              checked={timingRow.dailyAtHour != null}
              onChange={e => saveTiming({ dailyAtHour: e.target.checked ? 8 : null })}
              className="h-5 w-5 accent-[var(--accent)] cursor-pointer"
            />
          </label>
          <label className="flex items-center justify-between gap-2 py-1">
            <span className="text-sm text-slate-700">Before each session</span>
            <select
              value={timingRow.minutesBefore ?? ''}
              onChange={e => saveTiming({ minutesBefore: e.target.value ? Number(e.target.value) : null })}
              className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            >
              {LEAD_OPTIONS.map(o => <option key={o.label} value={o.minutes ?? ''}>{o.label}</option>)}
            </select>
          </label>
        </div>
      )}
    </section>
  )
}
