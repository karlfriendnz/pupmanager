'use client'

import { useEffect, useState, useTransition } from 'react'
import { Card, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { Loader2, Bell, Mail, Send, ChevronDown } from 'lucide-react'
import { NOTIFICATION_TYPES } from '@/lib/notification-types'

type NotificationType = keyof typeof NOTIFICATION_TYPES
type Channel = 'PUSH' | 'EMAIL'

interface PrefRow {
  type: NotificationType
  channel: Channel
  enabled: boolean
  minutesBefore: number | null
  dailyAtHour: number | null
  customTitle: string | null
  customBody: string | null
}

const MINUTES_OPTIONS = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180]
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => h)

export function NotificationsPanel({
  notifyEmail: initialNotifyEmail,
  notifyPush: initialNotifyPush,
}: {
  notifyEmail: boolean
  notifyPush: boolean
}) {
  const [rows, setRows] = useState<PrefRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/notification-preferences')
      .then(async r => {
        const text = await r.text()
        try {
          return JSON.parse(text)
        } catch {
          throw new Error(`HTTP ${r.status} — non-JSON body: ${text.slice(0, 200) || '(empty)'}`)
        }
      })
      .then(d => {
        if (d.error) throw new Error(d.error)
        setRows(d.preferences)
      })
      .catch(e => setLoadError(e.message ?? 'Failed to load'))
  }, [])

  const updateLocal = (type: NotificationType, channel: Channel, patch: Partial<PrefRow>) => {
    setRows(prev => prev?.map(r => r.type === type && r.channel === channel ? { ...r, ...patch } : r) ?? null)
  }

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Notifications</h2>
        <p className="text-sm text-slate-500">Choose which alerts you want, when they fire, and how the message reads. Use {'{{placeholders}}'} to personalise the copy.</p>
      </div>

      <ChannelKillSwitches initialEmail={initialNotifyEmail} initialPush={initialNotifyPush} />

      {loadError && <Alert variant="error">Couldn&apos;t load preferences: {loadError}</Alert>}
      {!loadError && !rows && (
        <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      )}
      {rows && (
        <div className="flex flex-col gap-3">
          {Object.values(NOTIFICATION_TYPES).map(meta => (
            <NotificationCard
              key={meta.type}
              meta={meta}
              rows={rows.filter(r => r.type === meta.type)}
              onLocalChange={(channel, patch) => updateLocal(meta.type as NotificationType, channel, patch)}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function ChannelKillSwitches({ initialEmail, initialPush }: { initialEmail: boolean; initialPush: boolean }) {
  const [notifyEmail, setNotifyEmail] = useState(initialEmail)
  const [notifyPush, setNotifyPush] = useState(initialPush)
  const [saving, startSaving] = useTransition()
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  function save(patch: { notifyEmail?: boolean; notifyPush?: boolean }) {
    if (patch.notifyEmail !== undefined) setNotifyEmail(patch.notifyEmail)
    if (patch.notifyPush !== undefined) setNotifyPush(patch.notifyPush)
    startSaving(async () => {
      setError(null)
      try {
        const r = await fetch('/api/user', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        })
        if (!r.ok) throw new Error('Save failed')
        setSavedAt(Date.now())
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Save failed')
      }
    })
  }

  return (
    <Card>
      <CardBody className="pt-4">
        <h3 className="text-sm font-semibold text-slate-900">Channels</h3>
        <p className="text-xs text-slate-500 mt-0.5 mb-3">Master switches for each delivery channel. Per-type controls are below.</p>
        <div className="flex flex-col gap-3">
          <label className="flex items-center justify-between">
            <span className="inline-flex items-center gap-2 text-sm font-medium text-slate-700"><Mail className="h-4 w-4 text-slate-500" /> Email notifications</span>
            <input type="checkbox" className="h-5 w-5" checked={notifyEmail} onChange={e => save({ notifyEmail: e.target.checked })} />
          </label>
          <label className="flex items-center justify-between">
            <span className="inline-flex items-center gap-2 text-sm font-medium text-slate-700"><Bell className="h-4 w-4 text-slate-500" /> Push notifications</span>
            <input type="checkbox" className="h-5 w-5" checked={notifyPush} onChange={e => save({ notifyPush: e.target.checked })} />
          </label>
        </div>
        <div className="min-h-[18px] mt-2 text-xs">
          {saving && <span className="text-slate-400 inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Saving…</span>}
          {!saving && savedAt && <span className="text-emerald-600">Saved</span>}
          {error && <span className="text-red-600">{error}</span>}
        </div>
      </CardBody>
    </Card>
  )
}

function NotificationCard({
  meta,
  rows,
  onLocalChange,
}: {
  meta: typeof NOTIFICATION_TYPES[NotificationType]
  rows: PrefRow[]
  onLocalChange: (channel: Channel, patch: Partial<PrefRow>) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const anyEnabled = rows.some(r => r.enabled)

  return (
    <Card>
      <CardBody className="pt-4">
        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          className="w-full flex items-start justify-between gap-3 text-left"
        >
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-900">{meta.label}</h3>
            <p className="text-xs text-slate-500 mt-0.5">{meta.description}</p>
            <p className="text-[11px] text-slate-400 mt-1">
              {anyEnabled ? rows.filter(r => r.enabled).map(r => r.channel === 'PUSH' ? 'Push' : 'Email').join(' + ') : 'Off'}
              {meta.trigger === 'time-before-event' && rows.find(r => r.channel === 'PUSH')?.minutesBefore != null
                ? ` · ${rows.find(r => r.channel === 'PUSH')!.minutesBefore} min before`
                : ''}
              {meta.trigger === 'time-of-day' && rows.find(r => r.enabled)?.dailyAtHour != null
                ? ` · at ${formatHour(rows.find(r => r.enabled)!.dailyAtHour!)}`
                : ''}
            </p>
          </div>
          <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform shrink-0 mt-1 ${expanded ? 'rotate-180' : ''}`} />
        </button>

        {expanded && (
          <div className="mt-4 flex flex-col gap-4 border-t border-slate-100 pt-4">
            {rows.map(row => (
              <PrefRowEditor
                key={row.channel}
                meta={meta}
                row={row}
                onLocalChange={(patch) => onLocalChange(row.channel, patch)}
              />
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  )
}

function PrefRowEditor({
  meta,
  row,
  onLocalChange,
}: {
  meta: typeof NOTIFICATION_TYPES[NotificationType]
  row: PrefRow
  onLocalChange: (patch: Partial<PrefRow>) => void
}) {
  const [saving, startSaving] = useTransition()
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [testState, setTestState] = useState<
    | { kind: 'idle' }
    | { kind: 'sending' }
    | { kind: 'sent' }
    | { kind: 'sentEmail'; to: string }
    | { kind: 'noDevices' }
    | { kind: 'noEmail' }
    | { kind: 'unsupported' }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' })

  function save(patch: Partial<PrefRow>) {
    onLocalChange(patch)
    startSaving(async () => {
      setError(null)
      try {
        const r = await fetch('/api/notification-preferences', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...row, ...patch }),
        })
        const data = await r.json()
        if (!data.ok) throw new Error(data.error ?? 'Save failed')
        setSavedAt(Date.now())
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Save failed')
      }
    })
  }

  async function sendTest() {
    setTestState({ kind: 'sending' })
    try {
      const r = await fetch('/api/notification-preferences/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: row.type,
          channel: row.channel,
          customTitle: row.customTitle ?? undefined,
          customBody: row.customBody ?? undefined,
        }),
      })
      const data = await r.json()
      if (data.reason === 'no-devices') return setTestState({ kind: 'noDevices' })
      if (data.reason === 'no-email') return setTestState({ kind: 'noEmail' })
      // Legacy stub response — kept so an old client opening a fresh
      // server still degrades gracefully if the API's ever rolled back.
      if (data.reason === 'email-test-not-implemented') return setTestState({ kind: 'unsupported' })
      if (data.reason === 'crash' || data.reason === 'email-send-failed' || !data.ok) {
        return setTestState({ kind: 'error', message: data.message ?? 'Send failed' })
      }
      if (row.channel === 'EMAIL') return setTestState({ kind: 'sentEmail', to: data.deliveredTo ?? '' })
      setTestState({ kind: 'sent' })
    } catch (e) {
      setTestState({ kind: 'error', message: e instanceof Error ? e.message : 'Network error' })
    }
  }

  const ChannelIcon = row.channel === 'PUSH' ? Bell : Mail
  const channelLabel = row.channel === 'PUSH' ? 'Push notification' : 'Email'

  return (
    <div className="flex flex-col gap-3 rounded-xl bg-slate-50/60 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ChannelIcon className="h-4 w-4 text-slate-500" />
          <span className="text-sm font-medium text-slate-700">{channelLabel}</span>
        </div>
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <span className="text-xs text-slate-500">{row.enabled ? 'On' : 'Off'}</span>
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={row.enabled}
            onChange={(e) => save({ enabled: e.target.checked })}
          />
        </label>
      </div>

      {row.enabled && (
        <>
          {meta.trigger === 'time-before-event' && (
            <label className="flex items-center justify-between gap-3">
              <span className="text-xs text-slate-600">Minutes before</span>
              <select
                className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm"
                value={row.minutesBefore ?? meta.defaults.minutesBefore ?? 20}
                onChange={(e) => save({ minutesBefore: Number(e.target.value) })}
              >
                {MINUTES_OPTIONS.map(m => <option key={m} value={m}>{m} min</option>)}
              </select>
            </label>
          )}
          {meta.trigger === 'time-of-day' && (
            <label className="flex items-center justify-between gap-3">
              <span className="text-xs text-slate-600">Send at</span>
              <select
                className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm"
                value={row.dailyAtHour ?? meta.defaults.dailyAtHour ?? 7}
                onChange={(e) => save({ dailyAtHour: Number(e.target.value) })}
              >
                {HOUR_OPTIONS.map(h => <option key={h} value={h}>{formatHour(h)}</option>)}
              </select>
            </label>
          )}

          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-600">Title</label>
            <input
              type="text"
              className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm"
              placeholder={meta.defaults.title}
              value={row.customTitle ?? ''}
              onChange={(e) => onLocalChange({ customTitle: e.target.value || null })}
              onBlur={(e) => save({ customTitle: e.target.value.trim() || null })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-600">Body</label>
            <textarea
              rows={2}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm resize-y"
              placeholder={meta.defaults.body}
              value={row.customBody ?? ''}
              onChange={(e) => onLocalChange({ customBody: e.target.value || null })}
              onBlur={(e) => save({ customBody: e.target.value.trim() || null })}
            />
          </div>

          <p className="text-[11px] text-slate-400">
            Placeholders: {meta.placeholders.map(p => <code key={p} className="ml-1 px-1 rounded bg-slate-200/60">{`{{${p}}}`}</code>)}
          </p>

          <div className="flex items-center justify-between gap-3 pt-1">
            <div className="flex items-center gap-2 min-h-[20px] text-xs">
              {saving && <span className="text-slate-400 inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Saving…</span>}
              {!saving && savedAt && <span className="text-emerald-600">Saved</span>}
              {error && <span className="text-red-600">{error}</span>}
            </div>
            <Button type="button" size="sm" variant="secondary" onClick={sendTest} loading={testState.kind === 'sending'}>
              <Send className="h-3.5 w-3.5 mr-1" /> Send test
            </Button>
          </div>
          {testState.kind === 'sent' && <Alert variant="success">Test sent — check your iPhone.</Alert>}
          {testState.kind === 'sentEmail' && <Alert variant="success">Test email sent{testState.to ? ` to ${testState.to}` : ''} — check your inbox (it can take up to a minute).</Alert>}
          {testState.kind === 'noDevices' && <Alert variant="info">No iOS devices registered. Open the app on iPhone, allow notifications, then try again.</Alert>}
          {testState.kind === 'noEmail' && <Alert variant="info">Your account doesn&apos;t have an email address — add one in account settings.</Alert>}
          {testState.kind === 'unsupported' && <Alert variant="info">Email channel test isn&apos;t implemented yet.</Alert>}
          {testState.kind === 'error' && <Alert variant="error">{testState.message}</Alert>}
        </>
      )}
    </div>
  )
}

function formatHour(h: number): string {
  if (h === 0) return '12 am'
  if (h === 12) return '12 pm'
  if (h < 12) return `${h} am`
  return `${h - 12} pm`
}
