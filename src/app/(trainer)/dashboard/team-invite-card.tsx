'use client'

import { useState } from 'react'
import { Loader2, Check, Plus, Users, X } from 'lucide-react'
import { Card } from '@/components/ui/card'

// Dashboard prompt to send the team invites the owner captured during onboarding
// but chose to hold. Sending is deliberate here — done once they've set the
// system up, so staff don't open a blank app. Each becomes a STAFF invite via
// the team endpoint (free while trialing). Successfully-sent emails drop off the
// pending list; failures stay for retry.

type InviteRow = { email: string; status: 'idle' | 'sending' | 'sent' | 'error'; error?: string }

function deriveInviteName(email: string): string {
  const local = (email.split('@')[0] ?? '').replace(/[._+-]+/g, ' ').trim()
  const name = local.charAt(0).toUpperCase() + local.slice(1)
  return name.length >= 2 ? name : 'Team member'
}

const isEmail = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)

export function TeamInviteCard({ pending }: { pending: string[] }) {
  const [dismissed, setDismissed] = useState(false)
  const [rows, setRows] = useState<InviteRow[]>(
    pending.length ? pending.map(email => ({ email, status: 'idle' as const })) : [{ email: '', status: 'idle' }],
  )
  const [sending, setSending] = useState(false)

  function update(i: number, patch: Partial<InviteRow>) {
    setRows(rs => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }

  // Persist whatever's still unsent back to the profile so the list survives.
  async function savePending(list: InviteRow[]) {
    const stillPending = list.filter(r => r.status !== 'sent' && isEmail(r.email.trim())).map(r => r.email.trim())
    await fetch('/api/trainer/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pendingTeamInvites: stillPending }),
    }).catch(() => {})
  }

  async function sendAll() {
    setSending(true)
    const results = await Promise.all(rows.map(async (r): Promise<InviteRow> => {
      const email = r.email.trim()
      if (!email || r.status === 'sent') return r
      if (!isEmail(email)) return { ...r, status: 'error', error: 'Enter a valid email' }
      try {
        const res = await fetch('/api/trainer/team', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: deriveInviteName(email), email, role: 'STAFF' }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          return { ...r, status: 'error', error: body.error ?? 'Could not invite' }
        }
        return { ...r, status: 'sent', error: undefined }
      } catch {
        return { ...r, status: 'error', error: 'Could not invite' }
      }
    }))
    setRows(results)
    await savePending(results)
    setSending(false)
    // Nothing left to send → clear the card away.
    if (results.every(r => r.status === 'sent' || !r.email.trim())) setDismissed(true)
  }

  if (dismissed) return null

  const anyToSend = rows.some(r => r.email.trim() && r.status !== 'sent')

  return (
    <Card className="mb-6 p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-600">
          <Users className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-[15px] font-semibold text-slate-900">Ready to bring your team on?</h3>
              <p className="mt-0.5 text-[13px] text-slate-500">You saved these during setup — send the invites now that things are ready. Free while you’re on trial; they’ll get an email to join and set their own password.</p>
            </div>
            <button type="button" onClick={() => setDismissed(true)} aria-label="Not now" className="-mr-1 -mt-1 shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-3 flex flex-col gap-2">
            {rows.map((r, i) => (
              <div key={i}>
                <div className="flex items-center gap-2">
                  <input
                    type="email"
                    value={r.email}
                    onChange={e => update(i, { email: e.target.value, status: r.status === 'error' ? 'idle' : r.status })}
                    disabled={r.status === 'sent'}
                    placeholder="name@example.com"
                    className="flex-1 rounded-xl border border-slate-200 px-3.5 h-11 text-[14px] focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-slate-50 disabled:text-slate-400"
                  />
                  {r.status === 'sent' && (
                    <span className="inline-flex items-center gap-1 text-[12px] font-medium text-teal-600"><Check className="h-4 w-4" /> Invited</span>
                  )}
                  {r.status === 'sending' && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
                </div>
                {r.status === 'error' && <p className="mt-1 text-[12px] text-red-500">{r.error}</p>}
              </div>
            ))}
          </div>

          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={() => setRows(rs => [...rs, { email: '', status: 'idle' }])}
              className="inline-flex items-center gap-1 text-[13px] font-medium text-teal-700 hover:underline"
            >
              <Plus className="h-3.5 w-3.5" /> Add another
            </button>
            <button
              type="button"
              onClick={sendAll}
              disabled={sending || !anyToSend}
              className="ml-auto inline-flex items-center gap-2 rounded-xl bg-teal-600 hover:bg-teal-700 px-4 h-10 text-[13px] font-semibold text-white disabled:opacity-50"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Send invites now
            </button>
          </div>
        </div>
      </div>
    </Card>
  )
}
