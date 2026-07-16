'use client'

import { useCallback, useEffect, useRef, useState, useTransition, Fragment } from 'react'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { Loader2, Bell, Mail, Smartphone, Send } from 'lucide-react'
import { NOTIFICATION_TYPES } from '@/lib/notification-types'
import { RichTextEditor } from '@/components/shared/rich-text-editor'
import { htmlHasText } from '@/lib/email-html'

type NotificationType = keyof typeof NOTIFICATION_TYPES
type Channel = 'PUSH' | 'EMAIL' | 'IN_APP'

interface PrefRow {
  type: NotificationType
  channel: Channel
  enabled: boolean
  minutesBefore: number | null
  dailyAtHour: number | null
  customTitle: string | null
  customBody: string | null
}

// A team member the signed-in owner/manager is allowed to manage (resolved
// server-side in settings/page.tsx — same rule team-panel uses: not the owner,
// not yourself). Empty/undefined → the panel is self-only, exactly as before.
export interface ManageableMember {
  userId: string
  name: string
  role: string
}

const MINUTES_OPTIONS = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180]
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => h)
const roleLabel = (role: string) => role.charAt(0) + role.slice(1).toLowerCase()
const TRAINER_TYPES = Object.values(NOTIFICATION_TYPES).filter(m => m.audience !== 'client')
const CHANNELS: { id: Channel; label: string; Icon: typeof Bell }[] = [
  { id: 'IN_APP', label: 'In-app', Icon: Bell },
  { id: 'PUSH', label: 'Phone', Icon: Smartphone },
  { id: 'EMAIL', label: 'Email', Icon: Mail },
]

export function NotificationsPanel({ manageableMembers = [] }: { manageableMembers?: ManageableMember[] }) {
  const [rows, setRows] = useState<PrefRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  // null = the signed-in user ("Me"); otherwise a manageable member's userId.
  const [editingUserId, setEditingUserId] = useState<string | null>(null)
  const editingMember = manageableMembers.find(m => m.userId === editingUserId) ?? null

  const load = useCallback((userId: string | null) => {
    setRows(null); setLoadError(null); setExpanded(null)
    const qs = userId ? `?userId=${encodeURIComponent(userId)}` : ''
    fetch(`/api/notification-preferences${qs}`)
      .then(async r => {
        const text = await r.text()
        try { return JSON.parse(text) } catch { throw new Error(`HTTP ${r.status} — non-JSON body: ${text.slice(0, 200) || '(empty)'}`) }
      })
      .then(d => { if (d.error) throw new Error(d.error); setRows(d.preferences) })
      .catch(e => setLoadError(e.message ?? 'Failed to load'))
  }, [])

  useEffect(() => { load(editingUserId) }, [editingUserId, load])

  const updateLocal = (type: NotificationType, channel: Channel, patch: Partial<PrefRow>) =>
    setRows(prev => prev?.map(r => r.type === type && r.channel === channel ? { ...r, ...patch } : r) ?? null)

  const rowOf = (type: string, channel: Channel) => rows?.find(r => r.type === type && r.channel === channel)
  const supports = (type: string, channel: Channel) => NOTIFICATION_TYPES[type as NotificationType].channels.includes(channel)

  async function saveCell(type: NotificationType, channel: Channel, patch: Partial<PrefRow>) {
    const cur = rowOf(type, channel)
    updateLocal(type, channel, patch)
    await fetch('/api/notification-preferences', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...cur, ...patch, type, channel, targetUserId: editingUserId ?? undefined }),
    }).catch(() => {})
  }

  const columnOn = (channel: Channel) =>
    TRAINER_TYPES.filter(t => supports(t.type, channel)).every(t => rowOf(t.type, channel)?.enabled)
  async function toggleColumn(channel: Channel) {
    const target = !columnOn(channel)
    for (const t of TRAINER_TYPES) if (supports(t.type, channel)) await saveCell(t.type as NotificationType, channel, { enabled: target })
  }

  return (
    <section className="flex flex-col gap-6 md:max-w-2xl">
      <p className="text-sm text-slate-500 leading-snug">In-app shows in your notifications bell and as a pop-up toast. Phone sends a push to your device; Email lands in your inbox.</p>

      {/* Owners/managers can tune a team member's prefs. Hidden entirely when
          there's no one manageable (self-only, exactly as before). */}
      {manageableMembers.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="notify-editing-for" className="text-sm font-medium text-slate-600">Editing for</label>
          <select
            id="notify-editing-for"
            value={editingUserId ?? ''}
            onChange={(e) => setEditingUserId(e.target.value || null)}
            className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-900"
          >
            <option value="">Me</option>
            {manageableMembers.map(m => (
              <option key={m.userId} value={m.userId}>{m.name} — {roleLabel(m.role)}</option>
            ))}
          </select>
        </div>
      )}
      {editingMember && (
        <Alert variant="info">You&apos;re editing {editingMember.name}&apos;s notifications — changes save to their account.</Alert>
      )}

      {loadError && <Alert variant="error">Couldn&apos;t load preferences: {loadError}</Alert>}
      {!loadError && !rows && <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}

      {rows && (
        <div className="rounded-2xl bg-white shadow-[0_2px_16px_rgba(15,31,36,0.05)] overflow-x-auto">
          <table className="w-full min-w-[480px]">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/70">
                <th className="text-left px-5 py-4 align-bottom">
                  <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400">Notify me</span>
                  <span className="block text-xs font-normal text-slate-400 mt-0.5 normal-case tracking-normal">Tap a row to set timing &amp; wording.</span>
                </th>
                {CHANNELS.map(({ id, label, Icon }) => {
                  const on = columnOn(id)
                  return (
                    <th key={id} className="px-3 py-4 w-[72px]">
                      <button type="button" onClick={() => toggleColumn(id)} title={`Toggle all ${label}`} className="flex flex-col items-center gap-1.5 w-full group">
                        <span className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors ${on ? 'bg-accent text-white shadow-sm' : 'bg-white text-slate-400 ring-1 ring-slate-200 group-hover:text-slate-600'}`}>
                          <Icon className="h-[18px] w-[18px]" />
                        </span>
                        <span className={`text-[11px] font-semibold leading-none ${on ? 'text-accent' : 'text-slate-500'}`}>{label}</span>
                      </button>
                    </th>
                  )
                })}
                <th className="px-4 py-4 w-[108px]"></th>
              </tr>
            </thead>
            <tbody>
              {TRAINER_TYPES.map(meta => {
                // Auto-curated types (fixed timing + copy) have nothing to edit,
                // so they aren't expandable — just the channel toggles.
                const canExpand = meta.customisable !== false
                const open = canExpand && expanded === meta.type
                return (
                  <Fragment key={meta.type}>
                    <tr className="border-t border-slate-50">
                      <td className="px-5 py-5 align-top">
                        <span className="block text-sm font-medium text-slate-900 leading-tight">{meta.label}</span>
                        <span className="block text-xs text-slate-400 leading-tight mt-0.5">{meta.description}</span>
                      </td>
                      {CHANNELS.map(({ id }) => {
                        if (!supports(meta.type, id)) return <td key={id} className="px-3 py-5 text-center align-middle text-slate-200">—</td>
                        const r = rowOf(meta.type, id)
                        return (
                          <td key={id} className="px-3 py-5 text-center align-middle">
                            <input type="checkbox" checked={!!r?.enabled} onChange={() => saveCell(meta.type as NotificationType, id, { enabled: !r?.enabled })} aria-label={`${meta.label} — ${id}`} className="h-5 w-5 accent-[var(--accent)] cursor-pointer" />
                          </td>
                        )
                      })}
                      <td className="px-4 py-5 text-right align-middle">
                        {canExpand && (
                          <button type="button" onClick={() => setExpanded(open ? null : meta.type)} className={`inline-flex items-center rounded-lg px-2.5 h-8 text-xs font-medium border transition-colors ${open ? 'border-accent bg-accent-soft text-accent' : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}>
                            {open ? 'Done' : 'Customise'}
                          </button>
                        )}
                      </td>
                    </tr>
                    {open && (
                      <tr className="bg-slate-50/50">
                        <td colSpan={2 + CHANNELS.length} className="px-5 pb-5 pt-1">
                          <div className="flex flex-col gap-3">
                            {CHANNELS.filter(c => supports(meta.type, c.id)).map(c => {
                              const r = rowOf(meta.type, c.id)
                              if (!r) return null
                              return <PrefRowEditor key={c.id} meta={meta} row={r} targetUserId={editingUserId ?? undefined} onLocalChange={(patch) => updateLocal(meta.type as NotificationType, c.id, patch)} />
                            })}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function PrefRowEditor({
  meta,
  row,
  targetUserId,
  onLocalChange,
}: {
  meta: typeof NOTIFICATION_TYPES[NotificationType]
  row: PrefRow
  targetUserId?: string
  onLocalChange: (patch: Partial<PrefRow>) => void
}) {
  const [saving, startSaving] = useTransition()
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Latest editor HTML (EMAIL channel) so we can save on blur without an event.
  const bodyRef = useRef(row.customBody ?? '')
  const [testState, setTestState] = useState<
    | { kind: 'idle' } | { kind: 'sending' } | { kind: 'sent' } | { kind: 'sentEmail'; to: string }
    | { kind: 'noDevices' } | { kind: 'noEmail' } | { kind: 'unsupported' } | { kind: 'error'; message: string }
  >({ kind: 'idle' })

  function save(patch: Partial<PrefRow>) {
    onLocalChange(patch)
    startSaving(async () => {
      setError(null)
      try {
        const r = await fetch('/api/notification-preferences', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...row, ...patch, targetUserId }) })
        const data = await r.json()
        if (!data.ok) throw new Error(data.error ?? 'Save failed')
        setSavedAt(Date.now())
      } catch (e) { setError(e instanceof Error ? e.message : 'Save failed') }
    })
  }

  async function sendTest() {
    setTestState({ kind: 'sending' })
    try {
      const r = await fetch('/api/notification-preferences/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: row.type, channel: row.channel, customTitle: row.customTitle ?? undefined, customBody: row.customBody ?? undefined }),
      })
      const data = await r.json()
      if (data.reason === 'no-devices') return setTestState({ kind: 'noDevices' })
      if (data.reason === 'no-email') return setTestState({ kind: 'noEmail' })
      if (data.reason === 'email-test-not-implemented') return setTestState({ kind: 'unsupported' })
      if (data.reason === 'crash' || data.reason === 'email-send-failed' || !data.ok) return setTestState({ kind: 'error', message: data.message ?? 'Send failed' })
      if (row.channel === 'EMAIL') return setTestState({ kind: 'sentEmail', to: data.deliveredTo ?? '' })
      setTestState({ kind: 'sent' })
    } catch (e) { setTestState({ kind: 'error', message: e instanceof Error ? e.message : 'Network error' }) }
  }

  const channelMeta = CHANNELS.find(c => c.id === row.channel) ?? CHANNELS[0]
  const ChannelIcon = channelMeta.Icon
  const channelLabel = channelMeta.label

  return (
    <div className="flex flex-col gap-3 rounded-xl bg-white ring-1 ring-slate-100 p-3">
      <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
        <ChannelIcon className="h-4 w-4 text-slate-500" /> {channelLabel}
        <span className={`ml-auto text-[11px] font-medium ${row.enabled ? 'text-emerald-600' : 'text-slate-400'}`}>{row.enabled ? 'On' : 'Off — turn it on above'}</span>
      </div>

      {meta.customisable !== false && meta.trigger === 'time-before-event' && (
        <label className="flex items-center justify-between gap-3">
          <span className="text-xs text-slate-600">Minutes before</span>
          <select className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm" value={row.minutesBefore ?? meta.defaults.minutesBefore ?? 20} onChange={(e) => save({ minutesBefore: Number(e.target.value) })}>
            {MINUTES_OPTIONS.map(m => <option key={m} value={m}>{m} min</option>)}
          </select>
        </label>
      )}
      {meta.customisable !== false && meta.trigger === 'time-of-day' && (
        <label className="flex items-center justify-between gap-3">
          <span className="text-xs text-slate-600">Send at</span>
          <select className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm" value={row.dailyAtHour ?? meta.defaults.dailyAtHour ?? 7} onChange={(e) => save({ dailyAtHour: Number(e.target.value) })}>
            {HOUR_OPTIONS.map(h => <option key={h} value={h}>{formatHour(h)}</option>)}
          </select>
        </label>
      )}

      {meta.customisable !== false ? (
        <>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-600">Title</label>
            <input type="text" className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm" placeholder={meta.defaults.title} value={row.customTitle ?? ''} onChange={(e) => onLocalChange({ customTitle: e.target.value || null })} onBlur={(e) => save({ customTitle: e.target.value.trim() || null })} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-600">Body</label>
            {row.channel === 'EMAIL' ? (
              // Rich-text for the email body; push stays plain text below.
              <RichTextEditor
                theme="light"
                minHeight={90}
                value={row.customBody ?? ''}
                onChange={(html) => { bodyRef.current = html; onLocalChange({ customBody: html || null }) }}
                onBlur={() => save({ customBody: htmlHasText(bodyRef.current) ? bodyRef.current : null })}
              />
            ) : (
              <textarea rows={2} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm resize-y" placeholder={meta.defaults.body} value={row.customBody ?? ''} onChange={(e) => onLocalChange({ customBody: e.target.value || null })} onBlur={(e) => save({ customBody: e.target.value.trim() || null })} />
            )}
          </div>
          <p className="text-[11px] text-slate-400">Placeholders: {meta.placeholders.map(p => <code key={p} className="ml-1 px-1 rounded bg-slate-200/60">{`{{${p}}}`}</code>)}</p>
        </>
      ) : (
        <p className="text-[11px] text-slate-500 italic">Auto-curated — we look after the timing and copy.</p>
      )}

      <div className="flex items-center justify-between gap-3 pt-1">
        <div className="flex items-center gap-2 min-h-[20px] text-xs">
          {saving && <span className="text-slate-400 inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Saving…</span>}
          {!saving && savedAt && <span className="text-emerald-600">Saved</span>}
          {error && <span className="text-red-600">{error}</span>}
        </div>
        {row.channel === 'IN_APP' ? (
          // In-app has nothing to "send" — it just appears in the bell/toast as
          // notifications fire, so there's no test-send for this channel.
          <span className="text-[11px] text-slate-400">Appears live in your bell &amp; toast</span>
        ) : (
          <Button type="button" size="sm" variant="secondary" onClick={sendTest} loading={testState.kind === 'sending'}>
            <Send className="h-3.5 w-3.5 mr-1" /> Send test
          </Button>
        )}
      </div>
      {testState.kind === 'sent' && <Alert variant="success">Test sent — check your iPhone.</Alert>}
      {testState.kind === 'sentEmail' && <Alert variant="success">Test email sent{testState.to ? ` to ${testState.to}` : ''} — check your inbox.</Alert>}
      {testState.kind === 'noDevices' && <Alert variant="info">No iOS devices registered. Open the app on iPhone, allow notifications, then try again.</Alert>}
      {testState.kind === 'noEmail' && <Alert variant="info">Your account doesn&apos;t have an email address — add one in account settings.</Alert>}
      {testState.kind === 'unsupported' && <Alert variant="info">Email channel test isn&apos;t implemented yet.</Alert>}
      {testState.kind === 'error' && <Alert variant="error">{testState.message}</Alert>}
    </div>
  )
}

function formatHour(h: number): string {
  if (h === 0) return '12 am'
  if (h === 12) return '12 pm'
  if (h < 12) return `${h} am`
  return `${h - 12} pm`
}
