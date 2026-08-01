'use client'

import { useEffect, useState } from 'react'
import { Loader2, Lock, Globe, Trophy, Mail, Check, X, Search } from 'lucide-react'

// WHO a package is for — the trainer's side of the ladder.
//
// Three modes, and the wording is chosen carefully because this is the setting
// most likely to be mis-set in a way nobody notices: a package that has quietly
// vanished from every client's screen looks exactly like a package nobody
// wants. So the mode says who CAN join, and a separate switch says what the
// people who can't should see.
export type Eligibility = 'PUBLIC' | 'ACHIEVEMENT' | 'INVITE_ONLY'

export interface AchievementOption { id: string; name: string }
export interface ClientOption { id: string; name: string }

const MODES: { id: Eligibility; label: string; hint: string; Icon: React.ComponentType<{ className?: string; strokeWidth?: number }> }[] = [
  { id: 'PUBLIC', label: 'Anyone', hint: 'Every client can see and join this.', Icon: Globe },
  { id: 'ACHIEVEMENT', label: 'Once they’ve earned it', hint: 'They must already hold the achievements you pick.', Icon: Trophy },
  { id: 'INVITE_ONLY', label: 'Only people I invite', hint: 'Nobody sees a way in until you invite them.', Icon: Mail },
]

export function EligibilityEditor({
  membershipId,
  eligibility,
  showWhenLocked,
  prerequisiteIds,
  achievements,
  clients,
  onChange,
}: {
  /** Null while the package is still unsaved — invites need a real row to hang off. */
  membershipId: string | null
  eligibility: Eligibility
  showWhenLocked: boolean
  prerequisiteIds: string[]
  achievements: AchievementOption[]
  clients: ClientOption[]
  onChange: (patch: { eligibility?: Eligibility; showWhenLocked?: boolean; prerequisiteIds?: string[] }) => void
}) {
  const gated = eligibility !== 'PUBLIC'

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="text-sm font-medium text-slate-700">Who can join this?</p>
        <div className="mt-2 flex flex-col gap-2">
          {MODES.map(m => {
            const active = eligibility === m.id
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => onChange({ eligibility: m.id })}
                className={`flex items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition ${
                  active ? 'border-violet-300 bg-violet-50' : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <m.Icon className={`h-4 w-4 shrink-0 mt-0.5 ${active ? 'text-violet-600' : 'text-slate-400'}`} strokeWidth={1.75} />
                <span className="min-w-0">
                  <span className={`block text-sm font-medium ${active ? 'text-violet-900' : 'text-slate-700'}`}>{m.label}</span>
                  <span className="block text-xs text-slate-500">{m.hint}</span>
                </span>
                {active && <Check className="h-4 w-4 shrink-0 text-violet-600 ml-auto" strokeWidth={2} />}
              </button>
            )
          })}
        </div>
      </div>

      {eligibility === 'ACHIEVEMENT' && (
        <AchievementPicker
          achievements={achievements}
          selected={prerequisiteIds}
          onChange={ids => onChange({ prerequisiteIds: ids })}
        />
      )}

      {gated && (
        <label className="flex items-start gap-3 rounded-xl border border-slate-200 px-3.5 py-3 cursor-pointer hover:bg-slate-50">
          <input
            type="checkbox"
            checked={showWhenLocked}
            onChange={e => onChange({ showWhenLocked: e.target.checked })}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-slate-700">Show it to everyone else, locked</span>
            <span className="block text-xs text-slate-500">
              {showWhenLocked
                ? 'Clients who can’t join see it greyed out, with what they’d need. Good for something to work towards.'
                : 'Clients who can’t join won’t see it at all.'}
            </span>
          </span>
        </label>
      )}

      {gated && membershipId && <Invites membershipId={membershipId} clients={clients} />}
      {gated && !membershipId && (
        <p className="text-xs text-slate-500">Save the package first, then you can invite people to it.</p>
      )}
    </div>
  )
}

/**
 * Every prerequisite is required, not any of them. Said out loud on the screen
 * because "pick some achievements" reads as any-of to most people, and the
 * difference is whether a client can skip a rung.
 */
function AchievementPicker({
  achievements,
  selected,
  onChange,
}: {
  achievements: AchievementOption[]
  selected: string[]
  onChange: (ids: string[]) => void
}) {
  const [q, setQ] = useState('')
  // A trainer can have a lot of these, and a long list is unusable — but a
  // search box over five items is noise.
  const searchable = achievements.length > 8
  const shown = q.trim()
    ? achievements.filter(a => a.name.toLowerCase().includes(q.trim().toLowerCase()))
    : achievements

  if (achievements.length === 0) {
    return (
      <p className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm text-amber-800">
        You haven’t made any achievements yet, so there’s nothing to require. Until you pick one this
        package stays open to everyone.
      </p>
    )
  }

  return (
    <div>
      <p className="text-sm font-medium text-slate-700">They must already have</p>
      <p className="text-xs text-slate-500">All of these, not just one.</p>
      {searchable && (
        <div className="relative mt-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" strokeWidth={1.75} />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search achievements"
            className="w-full h-10 pl-9 pr-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        {shown.map(a => {
          const on = selected.includes(a.id)
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => onChange(on ? selected.filter(id => id !== a.id) : [...selected, a.id])}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 h-8 text-sm transition ${
                on ? 'border-violet-300 bg-violet-50 text-violet-800' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {on ? <Check className="h-3.5 w-3.5" strokeWidth={2} /> : <Trophy className="h-3.5 w-3.5 text-slate-400" strokeWidth={1.75} />}
              {a.name}
            </button>
          )
        })}
        {shown.length === 0 && <p className="text-sm text-slate-500">Nothing matches “{q}”.</p>}
      </div>
      {selected.length === 0 && (
        <p className="mt-2 text-xs text-slate-500">
          Nothing picked yet — until you choose one, this package is open to everyone.
        </p>
      )}
    </div>
  )
}

/**
 * Naming individual people. An invitation overrides the ladder entirely, which
 * is said on screen — a trainer inviting someone into an achievement-gated
 * package needs to know they are letting them past the requirement, not adding
 * them to a queue.
 */
function Invites({ membershipId, clients }: { membershipId: string; clients: ClientOption[] }) {
  const [invited, setInvited] = useState<{ clientId: string; name: string; status: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [q, setQ] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetch(`/api/trainer/memberships/${membershipId}/invites`)
      .then(r => (r.ok ? r.json() : { invites: [] }))
      .then(b => { if (alive) { setInvited(b.invites ?? []); setLoading(false) } })
      .catch(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [membershipId])

  async function send(clientIds: string[]) {
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/trainer/memberships/${membershipId}/invites`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientIds }),
      })
      if (!res.ok) { setError('Could not send that invitation.'); return }
      const list = await fetch(`/api/trainer/memberships/${membershipId}/invites`).then(r => r.json())
      setInvited(list.invites ?? [])
      setQ('')
    } finally {
      setBusy(false)
    }
  }

  async function withdraw(clientId: string) {
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/trainer/memberships/${membershipId}/invites`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientIds: [clientId] }),
      })
      if (!res.ok) { setError('Could not withdraw that invitation.'); return }
      setInvited(prev => prev.filter(i => i.clientId !== clientId))
    } finally {
      setBusy(false)
    }
  }

  const alreadyIn = new Set(invited.map(i => i.clientId))
  // Search-only: a trainer with 200 clients cannot pick from a list, and
  // showing the first 20 alphabetically is worse than showing none.
  const matches = q.trim()
    ? clients.filter(c => !alreadyIn.has(c.id) && c.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 8)
    : []

  return (
    <div>
      <p className="text-sm font-medium text-slate-700">Invited</p>
      <p className="text-xs text-slate-500">An invitation lets someone in whatever the rules above say.</p>

      {error && <p className="mt-2 rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-700">{error}</p>}

      <div className="relative mt-2">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" strokeWidth={1.75} />
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search your clients"
          className="w-full h-10 pl-9 pr-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
        />
      </div>

      {matches.length > 0 && (
        <div className="mt-2 flex flex-col gap-1 rounded-xl border border-slate-200 p-1">
          {matches.map(c => (
            <button
              key={c.id}
              type="button"
              disabled={busy}
              onClick={() => send([c.id])}
              className="flex items-center justify-between gap-2 rounded-lg px-3 h-10 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {c.name}
              <span className="text-xs font-medium text-violet-600">Invite</span>
            </button>
          ))}
        </div>
      )}

      <div className="mt-2 flex flex-col gap-1">
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
        ) : invited.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-slate-500"><Lock className="h-4 w-4 text-slate-400" strokeWidth={1.75} /> Nobody invited yet.</p>
        ) : (
          invited.map(i => (
            <div key={i.clientId} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 h-10">
              <span className="text-sm text-slate-700 truncate">{i.name}</span>
              <span className="flex items-center gap-2 shrink-0">
                {/* FULFILLED means they took it up. Withdrawing then would be a
                    cancellation of something they pay for, which belongs in the
                    cancel flow with its notice and refund rules — not here. */}
                {i.status === 'FULFILLED' ? (
                  <span className="text-xs font-medium text-emerald-600">Joined</span>
                ) : (
                  <>
                    <span className="text-xs text-slate-400">Invited</span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => withdraw(i.clientId)}
                      className="text-slate-400 hover:text-rose-600 disabled:opacity-50"
                      aria-label={`Withdraw invitation for ${i.name}`}
                    >
                      <X className="h-4 w-4" strokeWidth={1.75} />
                    </button>
                  </>
                )}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
