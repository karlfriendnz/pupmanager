'use client'

import { useState, useEffect, useCallback } from 'react'
import { Bell, Mail, Smartphone } from 'lucide-react'
import { NOTIFICATION_TYPES } from '@/lib/notification-types'
import type { NotificationChannel } from '@/generated/prisma'

// Morning summary (CLIENT_SESSION_DIGEST) is hidden — clients didn't want it.
const CLIENT_TYPES = Object.values(NOTIFICATION_TYPES).filter(m => m.audience === 'client' && m.type !== 'CLIENT_SESSION_DIGEST')
// Toggleable channels only — the in-app feed is always on (it's the history).
const CHANNELS: { id: NotificationChannel; label: string; Icon: typeof Bell }[] = [
  { id: 'PUSH', label: 'Phone', Icon: Smartphone },
  { id: 'EMAIL', label: 'Email', Icon: Mail },
]
const LEAD_OPTIONS: { short: string; minutes: number }[] = [
  { short: '30 min', minutes: 30 },
  { short: '1 hour', minutes: 60 },
  { short: '2 hours', minutes: 120 },
  { short: '1 day', minutes: 24 * 60 },
]
const REMINDER = 'CLIENT_SESSION_REMINDER'

type PrefRow = { type: string; channel: string; enabled: boolean; minutesBefore: number | null; leadMinutes: number[]; dailyAtHour: number | null }

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
  const row = (type: string, channel: string): PrefRow => prefs.get(`${type}:${channel}`) ?? {
    type, channel,
    enabled: (meta(type).defaultChannels ?? meta(type).channels).includes(channel as NotificationChannel),
    minutesBefore: meta(type).defaults.minutesBefore ?? null,
    leadMinutes: meta(type).defaults.minutesBefore ? [meta(type).defaults.minutesBefore!] : [],
    dailyAtHour: meta(type).defaults.dailyAtHour ?? null,
  }

  async function save(type: string, channel: string, patch: Partial<PrefRow>) {
    const next = { ...row(type, channel), ...patch }
    setPrefs(p => new Map(p).set(`${type}:${channel}`, next))
    await fetch('/api/notification-preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, channel, enabled: next.enabled, minutesBefore: next.minutesBefore, leadMinutes: next.leadMinutes, dailyAtHour: next.dailyAtHour }),
    }).catch(() => {})
  }

  const channelAllOn = (channel: string) => CLIENT_TYPES.every(t => row(t.type, channel).enabled)
  async function toggleColumn(channel: string) {
    const target = !channelAllOn(channel)
    for (const t of CLIENT_TYPES) await save(t.type, channel, { enabled: target })
  }

  // Reminder lead times — a set the client can multi-select. Stored on every
  // channel row of the reminder type so the cron can read it from any.
  const leads = row(REMINDER, 'PUSH').leadMinutes
  async function toggleLead(minutes: number) {
    const next = leads.includes(minutes) ? leads.filter(m => m !== minutes) : [...leads, minutes].sort((a, b) => a - b)
    for (const ch of CHANNELS) await save(REMINDER, ch.id, { leadMinutes: next })
  }

  if (!loaded) return <p className="text-sm text-slate-400 py-4">Loading…</p>

  return (
    <section className="md:max-w-xl">
      <p className="text-sm text-slate-500 mb-4 flex items-center gap-1.5"><Bell className="h-4 w-4 text-accent" /> Tap to choose what you hear about and how. Everything also shows in your in-app notifications.</p>

      <div className="rounded-2xl bg-white shadow-[0_2px_16px_rgba(15,31,36,0.05)] overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="text-left px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Notify me</th>
              {CHANNELS.map(({ id, label, Icon }) => (
                <th key={id} className="px-1 py-2 w-[72px]">
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
                  {t.type === REMINDER && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {LEAD_OPTIONS.map(o => {
                        const on = leads.includes(o.minutes)
                        return (
                          <button
                            key={o.minutes}
                            type="button"
                            onClick={() => toggleLead(o.minutes)}
                            className={`rounded-full px-2.5 h-7 text-xs font-medium border transition-colors ${on ? 'border-accent bg-accent-soft text-accent' : 'border-slate-200 text-slate-400'}`}
                          >
                            {o.short}
                          </button>
                        )
                      })}
                    </div>
                  )}
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
    </section>
  )
}
