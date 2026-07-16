'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { UserPlus, Trash2, Pencil, Loader2, Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert } from '@/components/ui/alert'
import { Modal } from '@/components/ui/modal'
import { useIsNative } from '@/lib/native'
import {
  PERMISSION_CATALOGUE,
  resolvePermissions,
  type PermissionKey,
  type PermissionDef,
} from '@/lib/permissions'

type Role = 'OWNER' | 'MANAGER' | 'STAFF'

interface Member {
  id: string
  name: string | null
  email: string
  role: Role
  title: string | null
  permissions: Partial<Record<PermissionKey, boolean>>
  status: 'ACTIVE' | 'PENDING'
  isOwner: boolean
  isSelf: boolean
}

interface TeamData {
  canManage: boolean
  isOwner: boolean
  canAddSeats: boolean
  seatCount: number
  seatsUsed: number
  hasSubscription: boolean
  members: Member[]
}

const GROUPS = ['Visibility', 'Clients', 'Scheduling', 'Catalogue', 'Communication', 'Business'] as const

function groupCatalogue(): Record<string, PermissionDef[]> {
  const out: Record<string, PermissionDef[]> = {}
  for (const def of PERMISSION_CATALOGUE) (out[def.group] ??= []).push(def)
  return out
}

// Editor for a role + its effective permission map. Used by both the invite
// form and the per-member edit row.
function PermissionEditor({
  effective,
  onToggle,
}: {
  effective: Record<PermissionKey, boolean>
  onToggle: (key: PermissionKey, value: boolean) => void
}) {
  const grouped = useMemo(() => groupCatalogue(), [])
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {GROUPS.map((group) => (
        <div key={group} className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">{group}</p>
          <div className="flex flex-col gap-3">
            {grouped[group]?.map((def) => (
              <label key={def.key} className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={effective[def.key]}
                  onChange={(e) => onToggle(def.key, e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="leading-tight">
                  <span className="block text-sm text-slate-700">{def.label}</span>
                  <span className="block text-xs text-slate-400">{def.description}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function RoleBadge({ role, status }: { role: Role; status: 'ACTIVE' | 'PENDING' }) {
  const roleStyles: Record<Role, string> = {
    OWNER: 'bg-violet-100 text-violet-700',
    MANAGER: 'bg-blue-100 text-blue-700',
    STAFF: 'bg-slate-100 text-slate-600',
  }
  return (
    <span className="flex items-center gap-1.5">
      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${roleStyles[role]}`}>
        {role.charAt(0) + role.slice(1).toLowerCase()}
      </span>
      {status === 'PENDING' && (
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">Invite sent</span>
      )}
    </span>
  )
}

export function TeamPanel() {
  const [data, setData] = useState<TeamData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/trainer/team')
      if (!res.ok) throw new Error('Could not load the team')
      setData(await res.json())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (loading && !data) {
    return (
      <div className="flex items-center gap-2 py-12 text-sm text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading team…
      </div>
    )
  }
  if (error && !data) return <Alert variant="error">{error}</Alert>
  if (!data) return null

  const seatsLeft = data.seatCount - data.seatsUsed

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Your team</h2>
          <p className="text-sm text-slate-500">
            {data.seatsUsed} of {data.seatCount} {data.seatCount === 1 ? 'seat' : 'seats'} used
            {data.canManage && seatsLeft <= 0 && (
              <span className="text-amber-600"> · no seats left</span>
            )}
          </p>
        </div>
        {data.canAddSeats && <AddSeatControl seatCount={data.seatCount} hasSubscription={data.hasSubscription} onChanged={load} />}
      </div>

      {data.canManage && <InviteForm onInvited={load} seatsLeft={seatsLeft} />}

      <div className="flex flex-col divide-y divide-slate-100 rounded-2xl border border-slate-100">
        {data.members.map((m) => (
          // actorIsOwner lets MemberRow apply the role hierarchy: a non-owner
          // manager can edit staff only, never another manager.
          <MemberRow key={m.id} member={m} canManage={data.canManage} actorIsOwner={data.isOwner} onChanged={load} />
        ))}
      </div>
    </div>
  )
}

// "Add a seat" — a PAID upgrade gated by the billing.seats permission.
// Increases the Stripe subscription's seat quantity (charged pro-rata); you
// can't grow the team for free. A trainer with no subscription is sent to
// subscribe first. The confirm modal re-authenticates with the user's
// password before charging. Hidden in native (Apple 3.1.1).
function AddSeatControl({ seatCount, hasSubscription, onChanged }: { seatCount: number; hasSubscription: boolean; onChanged: () => void }) {
  const native = useIsNative()
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [price, setPrice] = useState<{ seatPrice: number; symbol: string; currency: string } | null>(null)

  // Fetch the per-seat price in the trainer's billing currency when the
  // modal opens, so the charge is shown in their currency.
  useEffect(() => {
    if (!open || price) return
    fetch('/api/billing/seats')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d?.seatPrice != null) setPrice(d) })
      .catch(() => {})
  }, [open, price])

  if (native) return null

  // No subscription → seats are a paid feature they don't have yet.
  if (!hasSubscription) {
    return (
      <a
        href="/billing/setup"
        className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white"
        style={{ background: 'var(--pm-brand-600)' }}
      >
        <UserPlus className="h-4 w-4" /> Upgrade to add trainers
      </a>
    )
  }

  function close() { setOpen(false); setPassword(''); setError(null) }

  async function addSeat() {
    if (!password) { setError('Enter your password to confirm.'); return }
    setSaving(true); setError(null)
    try {
      const res = await fetch('/api/billing/seats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seatCount: seatCount + 1, password }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.status === 409 && json.needsSubscription) { window.location.href = '/billing/setup'; return }
      if (!res.ok) throw new Error(json.error ?? 'Could not add a seat')
      close()
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="flex flex-col items-end gap-1">
        <Button variant="secondary" onClick={() => setOpen(true)}>
          <UserPlus className="h-4 w-4" /> Add a seat
        </Button>
        <span className="text-xs text-slate-400">Billed per seat, pro-rata</span>
      </div>

      {open && (
        <Modal open onClose={close} title="Add a trainer seat">
          <p className="text-sm text-slate-600">
            This adds a paid trainer seat{price ? ` (${price.symbol}${price.seatPrice}/mo ${price.currency})` : ''} to
            your subscription, billed per seat and pro-rated to your card on file now.
            Confirm your password to continue.
          </p>
          <form
            onSubmit={(e) => { e.preventDefault(); addSeat() }}
            className="mt-4 flex flex-col gap-3"
          >
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-slate-700">Your password</label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                autoFocus
              />
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="mt-1 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={close} disabled={saving}>Cancel</Button>
              <Button type="submit" loading={saving}>Confirm &amp; pay</Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  )
}

function InviteForm({ onInvited, seatsLeft }: { onInvited: () => void; seatsLeft: number }) {
  // Don't reference Billing/seat purchasing inside the native app (Apple 3.1.1).
  const native = useIsNative()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [title, setTitle] = useState('')
  const [role, setRole] = useState<Exclude<Role, 'OWNER'>>('STAFF')
  const [overrides, setOverrides] = useState<Partial<Record<PermissionKey, boolean>>>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const effective = useMemo(() => resolvePermissions(role, overrides), [role, overrides])

  function reset() {
    setName(''); setEmail(''); setTitle(''); setRole('STAFF'); setOverrides({}); setError(null)
  }

  function changeRole(next: Exclude<Role, 'OWNER'>) {
    setRole(next)
    setOverrides({}) // role preset reseeds the checkboxes
  }

  async function submit() {
    setSubmitting(true); setError(null); setNotice(null)
    try {
      const res = await fetch('/api/trainer/team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, role, title: title || null, permissions: effective }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Could not send invite')
      setNotice(json.emailError ? `Member added, but the invite email failed: ${json.emailError}` : `Invite sent to ${email}.`)
      reset(); setOpen(false); onInvited()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) {
    return (
      <div className="flex flex-col gap-2">
        {notice && <Alert variant="success">{notice}</Alert>}
        <div>
          <Button variant="secondary" onClick={() => setOpen(true)} disabled={seatsLeft <= 0}>
            <UserPlus className="h-4 w-4" /> Invite trainer
          </Button>
        </div>
        {seatsLeft <= 0 && (
          <p className="text-xs text-slate-400">
            {native
              ? 'You’ve used all your seats.'
              : 'You’ve used all your seats. Add more from Billing to invite another trainer.'}
          </p>
        )}
      </div>
    )
  }

  return (
    <div data-testid="invite-form" className="rounded-2xl border border-slate-200 bg-white p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-slate-900">Invite a trainer</h3>
        <button onClick={() => { reset(); setOpen(false) }} className="text-slate-400 hover:text-slate-600">
          <X className="h-5 w-5" />
        </button>
      </div>
      {error && <Alert variant="error">{error}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jess Carter" />
        <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jess@example.com" />
        <Input label="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Senior trainer" />
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-slate-700">Role</label>
          <select
            value={role}
            onChange={(e) => changeRole(e.target.value as Exclude<Role, 'OWNER'>)}
            className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="STAFF">Staff — sees only their assigned work</option>
            <option value="MANAGER">Manager — full access (no billing)</option>
          </select>
        </div>
      </div>
      <div>
        <p className="mb-2 text-sm font-medium text-slate-700">Permissions</p>
        <PermissionEditor effective={effective} onToggle={(k, v) => setOverrides((o) => ({ ...o, [k]: v }))} />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => { reset(); setOpen(false) }}>Cancel</Button>
        <Button onClick={submit} loading={submitting} disabled={!name || !email}>Send invite</Button>
      </div>
    </div>
  )
}

function MemberRow({ member, canManage, actorIsOwner, onChanged }: { member: Member; canManage: boolean; actorIsOwner: boolean; onChanged: () => void }) {
  const [editing, setEditing] = useState(false)
  const [role, setRole] = useState<Exclude<Role, 'OWNER'>>(member.role === 'OWNER' ? 'MANAGER' : member.role)
  const [title, setTitle] = useState(member.title ?? '')
  const [overrides, setOverrides] = useState<Partial<Record<PermissionKey, boolean>>>(member.permissions)
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const effective = useMemo(() => resolvePermissions(role, overrides), [role, overrides])
  // Owner is untouchable; a non-owner manager can only edit staff.
  const editable = canManage && !member.isOwner && (actorIsOwner || member.role === 'STAFF')

  async function save() {
    setSaving(true); setError(null)
    try {
      const res = await fetch(`/api/trainer/team/${member.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, title: title || null, permissions: effective }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Could not save')
      setEditing(false); onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!confirm(`Remove ${member.name ?? member.email} from the team?`)) return
    setRemoving(true); setError(null)
    try {
      const res = await fetch(`/api/trainer/team/${member.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Could not remove')
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
      setRemoving(false)
    }
  }

  return (
    <div className="p-5" data-testid={`member-${member.email}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium text-slate-900">{member.name ?? member.email}</span>
            {member.isSelf && <span className="text-xs text-slate-400">(you)</span>}
          </div>
          <p className="truncate text-sm text-slate-500">
            {member.email}
            {member.title && <span className="text-slate-400"> · {member.title}</span>}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <RoleBadge role={member.role} status={member.status} />
          {editable && !editing && (
            <div className="flex items-center gap-1">
              <button onClick={() => setEditing(true)} className="grid h-8 w-8 min-h-0 min-w-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600" title="Edit">
                <Pencil className="h-4 w-4" />
              </button>
              <button onClick={remove} disabled={removing} className="grid h-8 w-8 min-h-0 min-w-0 place-items-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600" title="Remove">
                {removing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              </button>
            </div>
          )}
        </div>
      </div>

      {error && <div className="mt-2"><Alert variant="error">{error}</Alert></div>}

      {editing && (
        <div className="mt-4 flex flex-col gap-4 rounded-xl border border-slate-100 bg-slate-50/50 p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Senior trainer" />
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-slate-700">Role</label>
              <select
                value={role}
                onChange={(e) => { setRole(e.target.value as Exclude<Role, 'OWNER'>); setOverrides({}) }}
                className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="STAFF">Staff</option>
                <option value="MANAGER">Manager</option>
              </select>
            </div>
          </div>
          <PermissionEditor effective={effective} onToggle={(k, v) => setOverrides((o) => ({ ...o, [k]: v }))} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            <Button onClick={save} loading={saving}><Check className="h-4 w-4" /> Save</Button>
          </div>
        </div>
      )}
    </div>
  )
}
