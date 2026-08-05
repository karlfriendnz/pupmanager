'use client'

import { useState, useEffect, useCallback, Fragment } from 'react'
import { Bell, Mail, Smartphone } from 'lucide-react'
import { NOTIFICATION_TYPES } from '@/lib/notification-types'
import type { NotificationChannel } from '@/generated/prisma'

const REMINDER = 'CLIENT_SESSION_REMINDER'
// Morning summary (CLIENT_SESSION_DIGEST) is hidden — clients didn't want it.
const CLIENT_TYPES = Object.values(NOTIFICATION_TYPES).filter(m => m.audience === 'client' && m.type !== 'CLIENT_SESSION_DIGEST')
const CHANNELS: { id: NotificationChannel; label: string; Icon: typeof Bell }[] = [
  { id: 'PUSH', label: 'Phone', Icon: Smartphone },
  { id: 'EMAIL', label: 'Email', Icon: Mail },
  { id: 'IN_APP', label: 'App', Icon: Bell },
]
const LEAD_OPTIONS: { label: string; minutes: number }[] = [
  { label: '1 day before', minutes: 24 * 60 },
  { label: '2 hours before', minutes: 120 },
  { label: '1 hour before', minutes: 60 },
  { label: '30 min before', minutes: 30 },
]
const ALL_LEADS = LEAD_OPTIONS.map(o => o.minutes)

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
    leadMinutes: (meta(type).defaultChannels ?? meta(type).channels).includes(channel as NotificationChannel) && meta(type).defaults.minutesBefore ? [meta(type).defaults.minutesBefore!] : [],
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

  // A reminder lead × channel cell — stored in that channel's leadMinutes set.
  const leadOn = (lead: number, channel: string) => row(REMINDER, channel).leadMinutes.includes(lead)
  async function toggleLead(lead: number, channel: string) {
    const cur = row(REMINDER, channel).leadMinutes
    const next = cur.includes(lead) ? cur.filter(m => m !== lead) : [...cur, lead].sort((a, b) => b - a)
    await save(REMINDER, channel, { leadMinutes: next, enabled: next.length > 0 })
  }

  // Per-column check-all: simple categories enabled + every reminder lead.
  const columnOn = (channel: string) =>
    CLIENT_TYPES.filter(t => t.type !== REMINDER).every(t => row(t.type, channel).enabled)
    && ALL_LEADS.every(m => row(REMINDER, channel).leadMinutes.includes(m))
  async function toggleColumn(channel: string) {
    const target = !columnOn(channel)
    for (const t of CLIENT_TYPES) {
      if (t.type === REMINDER) await save(REMINDER, channel, { leadMinutes: target ? [...ALL_LEADS] : [], enabled: target })
      else await save(t.type, channel, { enabled: target })
    }
  }

  if (!loaded) return <p className="text-sm text-slate-400 py-4">Loading…</p>

  const cell = (checked: boolean, onChange: () => void, label: string) => (
    <td className="px-1 py-2.5 text-center align-middle">
      <input type="checkbox" checked={checked} onChange={onChange} aria-label={label} className="h-5 w-5 accent-[var(--accent)] cursor-pointer" />
    </td>
  )

  return (
    <section className="md:max-w-xl">
      <div className="rounded-2xl bg-white shadow-[0_2px_16px_rgba(15,31,36,0.05)] overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/70">
              <th className="text-left px-3 py-2.5 align-bottom">
                <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400">Notify me</span>
                <span className="block text-xs font-normal text-slate-400 mt-0.5 normal-case tracking-normal">Tap to choose what you hear about and how.</span>
              </th>
              {CHANNELS.map(({ id, label, Icon }) => {
                const on = columnOn(id)
                return (
                  <th key={id} className="px-1 py-2.5 w-[64px]">
                    <button type="button" onClick={() => toggleColumn(id)} title={`Toggle all ${label}`} className="flex flex-col items-center gap-1.5 w-full group">
                      <span className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors ${on ? 'bg-accent text-white shadow-sm' : 'bg-white text-slate-400 ring-1 ring-slate-200 group-hover:text-slate-600'}`}>
                        <Icon className="h-[18px] w-[18px]" />
                      </span>
                      <span className={`text-[11px] font-semibold leading-none ${on ? 'text-accent' : 'text-slate-500'}`}>{label}</span>
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {CLIENT_TYPES.map(t => t.type === REMINDER ? (
              <Fragment key={t.type}>
                <tr className="border-t border-slate-100 bg-slate-50/50">
                  <td colSpan={1 + CHANNELS.length} className="px-3 pt-3 pb-1">
                    <p className="text-sm font-medium text-slate-900 leading-tight">{t.label}</p>
                    <p className="text-xs text-slate-400 leading-tight mt-0.5">{t.description}</p>
                  </td>
                </tr>
                {LEAD_OPTIONS.map(o => (
                  <tr key={o.minutes} className="border-t border-slate-50">
                    <td className="pl-6 pr-3 py-2.5 text-sm text-slate-700">{o.label}</td>
                    {CHANNELS.map(({ id }) => cell(leadOn(o.minutes, id), () => toggleLead(o.minutes, id), `${o.label} — ${id}`))}
                  </tr>
                ))}
              </Fragment>
            ) : (
              <tr key={t.type} className="border-t border-slate-50">
                <td className="px-3 py-3 align-top">
                  <p className="text-sm font-medium text-slate-900 leading-tight">{t.label}</p>
                  <p className="text-xs text-slate-400 leading-tight mt-0.5">{t.description}</p>
                </td>
                {CHANNELS.map(({ id }) => cell(row(t.type, id).enabled, () => save(t.type, id, { enabled: !row(t.type, id).enabled }), `${t.label} — ${id}`))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
