'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert } from '@/components/ui/alert'
import { PUBLIC_CLASS_ENROLLMENT_ENABLED } from '@/lib/feature-flags'

export type PackageColor = 'blue' | 'emerald' | 'amber' | 'rose' | 'purple' | 'orange' | 'teal' | 'indigo' | 'pink' | 'cyan'

const COLOR_OPTIONS: { id: PackageColor; label: string; swatch: string }[] = [
  { id: 'blue',    label: 'Blue',    swatch: 'bg-blue-500' },
  { id: 'emerald', label: 'Emerald', swatch: 'bg-emerald-500' },
  { id: 'amber',   label: 'Amber',   swatch: 'bg-amber-500' },
  { id: 'rose',    label: 'Rose',    swatch: 'bg-rose-500' },
  { id: 'purple',  label: 'Purple',  swatch: 'bg-purple-500' },
  { id: 'orange',  label: 'Orange',  swatch: 'bg-orange-500' },
  { id: 'teal',    label: 'Teal',    swatch: 'bg-teal-500' },
  { id: 'indigo',  label: 'Indigo',  swatch: 'bg-indigo-500' },
  { id: 'pink',    label: 'Pink',    swatch: 'bg-pink-500' },
  { id: 'cyan',    label: 'Cyan',    swatch: 'bg-cyan-500' },
]

export interface PkgRow {
  id: string
  name: string
  description: string | null
  sessionCount: number
  weeksBetween: number
  durationMins: number
  sessionType: 'IN_PERSON' | 'VIRTUAL'
  priceCents: number | null
  specialPriceCents: number | null
  color: PackageColor | null
  defaultSessionFormId: string | null
  requireSessionNotes: boolean
  // Group-class config (optional so an older loader that doesn't select
  // them still satisfies the type — the form defaults them).
  isGroup?: boolean
  capacity?: number | null
  allowDropIn?: boolean
  dropInPriceCents?: number | null
  allowWaitlist?: boolean
  publicEnrollment?: boolean
  clientSelfBook?: boolean
  selfBookRequiresApproval?: boolean
  assignments: number
}

export interface SessionFormOption {
  id: string
  name: string
}

// We collect price as a decimal string from the user (e.g. "120" or "120.50")
// then convert to cents server-side. This keeps the input UX natural without
// pulling in a money/decimal library.
const formSchema = z.object({
  name: z.string().min(1, 'Name required'),
  description: z.string().optional(),
  // 0 = ongoing — the trainer picks an end date when assigning the package.
  sessionCount: z.number().int().min(0).max(52),
  weeksBetween: z.number().int().min(0).max(52),
  durationMins: z.number().int().min(15).max(480),
  sessionType: z.enum(['IN_PERSON', 'VIRTUAL']),
  price: z.string().optional(),
  specialPrice: z.string().optional(),
  color: z.enum(['blue', 'emerald', 'amber', 'rose', 'purple', 'orange', 'teal', 'indigo', 'pink', 'cyan']).nullable().optional(),
})

export function dollarsToCents(s: string | undefined): number | null {
  if (!s || !s.trim()) return null
  const n = parseFloat(s)
  if (Number.isNaN(n) || n < 0) return null
  return Math.round(n * 100)
}

export function centsToDollars(cents: number | null): string {
  if (cents === null || cents === undefined) return ''
  return (cents / 100).toFixed(2).replace(/\.00$/, '')
}

type FormValues = z.infer<typeof formSchema>

/**
 * The shared package create/edit form. Used on the create page (/packages/new)
 * and the edit page (/packages/[packageId]/edit). Lays its fields out in a
 * responsive two-column grid (short inputs pair up; description, toggles and
 * the colour picker span both). Renders the fields + submit/cancel actions;
 * the surrounding page chrome is the caller's concern.
 */
export function PackageForm({
  existing,
  sessionForms,
  onCancel,
  onSaved,
}: {
  existing: PkgRow | null
  sessionForms: SessionFormOption[]
  onCancel: () => void
  onSaved: (p: PkgRow, isNew: boolean) => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [color, setColor] = useState<PackageColor | null>(existing?.color ?? null)
  const [defaultSessionFormId, setDefaultSessionFormId] = useState<string | null>(existing?.defaultSessionFormId ?? null)
  const [requireSessionNotes, setRequireSessionNotes] = useState<boolean>(existing?.requireSessionNotes ?? true)
  // Group-class config — extra state (not RHF fields).
  const [isGroup, setIsGroup] = useState<boolean>(existing?.isGroup ?? false)
  const [capacity, setCapacity] = useState<string>(
    existing?.capacity != null ? String(existing.capacity) : '',
  )
  const [allowDropIn, setAllowDropIn] = useState<boolean>(existing?.allowDropIn ?? false)
  const [dropInPrice, setDropInPrice] = useState<string>(centsToDollars(existing?.dropInPriceCents ?? null))
  const [allowWaitlist, setAllowWaitlist] = useState<boolean>(existing?.allowWaitlist ?? false)
  const [publicEnrollment, setPublicEnrollment] = useState<boolean>(existing?.publicEnrollment ?? false)
  // Client self-booking (independent of group classes).
  const [clientSelfBook, setClientSelfBook] = useState<boolean>(existing?.clientSelfBook ?? false)
  const [selfBookRequiresApproval, setSelfBookRequiresApproval] = useState<boolean>(existing?.selfBookRequiresApproval ?? true)
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: existing
      ? {
          name: existing.name,
          description: existing.description ?? '',
          sessionCount: existing.sessionCount,
          weeksBetween: existing.weeksBetween,
          durationMins: existing.durationMins,
          sessionType: existing.sessionType,
          price: centsToDollars(existing.priceCents),
          specialPrice: centsToDollars(existing.specialPriceCents),
        }
      : { sessionCount: 3, weeksBetween: 2, durationMins: 60, sessionType: 'IN_PERSON', price: '', specialPrice: '' },
  })

  async function onSubmit(values: FormValues) {
    setError(null)
    const url = existing ? `/api/packages/${existing.id}` : '/api/packages'
    const method = existing ? 'PATCH' : 'POST'
    // Convert the dollar-string price fields into cents before sending; the
    // server stores cents to dodge floating-point math.
    const { price, specialPrice, ...rest } = values
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...rest,
        description: values.description || null,
        priceCents: dollarsToCents(price),
        specialPriceCents: dollarsToCents(specialPrice),
        color,
        defaultSessionFormId,
        requireSessionNotes,
        isGroup,
        capacity: isGroup && capacity.trim() ? Math.max(0, Math.floor(Number(capacity))) : null,
        allowDropIn: isGroup && allowDropIn,
        dropInPriceCents: isGroup && allowDropIn ? dollarsToCents(dropInPrice) : null,
        allowWaitlist: isGroup && allowWaitlist,
        publicEnrollment: isGroup && publicEnrollment,
        clientSelfBook,
        selfBookRequiresApproval,
      }),
    })
    if (!res.ok) { setError('Failed to save.'); return }
    const saved = await res.json()
    onSaved(
      {
        id: saved.id,
        name: saved.name,
        description: saved.description,
        sessionCount: saved.sessionCount,
        weeksBetween: saved.weeksBetween,
        durationMins: saved.durationMins,
        sessionType: saved.sessionType,
        priceCents: saved.priceCents ?? null,
        specialPriceCents: saved.specialPriceCents ?? null,
        color: saved.color ?? null,
        defaultSessionFormId: saved.defaultSessionFormId ?? null,
        requireSessionNotes: saved.requireSessionNotes ?? true,
        isGroup: saved.isGroup ?? false,
        capacity: saved.capacity ?? null,
        allowDropIn: saved.allowDropIn ?? false,
        dropInPriceCents: saved.dropInPriceCents ?? null,
        allowWaitlist: saved.allowWaitlist ?? false,
        publicEnrollment: saved.publicEnrollment ?? false,
        clientSelfBook: saved.clientSelfBook ?? false,
        selfBookRequiresApproval: saved.selfBookRequiresApproval ?? true,
        assignments: existing?.assignments ?? 0,
      },
      !existing
    )
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-3">
      {error && <div className="md:col-span-2"><Alert variant="error">{error}</Alert></div>}

      <div className="md:col-span-2">
        <Input label="Name" placeholder="e.g. Puppy Foundations · 6 sessions" error={errors.name?.message} {...register('name')} />
      </div>

      <div className="md:col-span-2">
        <label className="text-sm font-medium text-slate-700 block mb-1.5">Description (optional)</label>
        <textarea
          {...register('description')}
          rows={3}
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div>
        <Input
          label="Number of sessions"
          type="number"
          error={errors.sessionCount?.message}
          {...register('sessionCount', { valueAsNumber: true })}
        />
        <p className="text-[11px] text-slate-400 mt-1">0 = ongoing (you set an end date when assigning)</p>
      </div>
      <Input
        label="Weeks between"
        type="number"
        error={errors.weeksBetween?.message}
        {...register('weeksBetween', { valueAsNumber: true })}
      />

      <Input
        label="Default duration (mins)"
        type="number"
        error={errors.durationMins?.message}
        {...register('durationMins', { valueAsNumber: true })}
      />

      <div>
        <label className="text-sm font-medium text-slate-700 block mb-1.5">Session type</label>
        <div className="flex gap-2">
          {(['IN_PERSON', 'VIRTUAL'] as const).map(t => (
            <label key={t} className="flex-1">
              <input type="radio" value={t} className="sr-only peer" {...register('sessionType')} />
              <div className="text-center py-2 rounded-xl border border-slate-200 text-sm cursor-pointer peer-checked:border-blue-500 peer-checked:bg-blue-50 peer-checked:text-blue-700 transition-colors">
                {t === 'IN_PERSON' ? '📍 In person' : '💻 Virtual'}
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Pricing — leave price blank for "no price set". The special price
          is independent and only shown when populated. */}
      <Input
        label="Price"
        type="text"
        inputMode="decimal"
        placeholder="120"
        {...register('price')}
      />
      <Input
        label="Special price (optional)"
        type="text"
        inputMode="decimal"
        placeholder="—"
        {...register('specialPrice')}
      />

      <div className="md:col-span-2">
        <label className="text-sm font-medium text-slate-700 block mb-1.5">Default session form</label>
        <p className="text-[11px] text-slate-400 mb-1.5">
          Auto-attached to each new session in this package. Trainer can still swap it on the session.
        </p>
        <select
          value={defaultSessionFormId ?? ''}
          onChange={e => setDefaultSessionFormId(e.target.value || null)}
          className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">None</option>
          {sessionForms.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </div>

      <label className="md:col-span-2 flex items-start gap-3 rounded-xl border border-slate-200 px-3 py-2.5 cursor-pointer">
        <input
          type="checkbox"
          checked={requireSessionNotes}
          onChange={e => setRequireSessionNotes(e.target.checked)}
          className="h-4 w-4 mt-0.5"
        />
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium text-slate-700">Send a follow-up reminder for session notes</span>
          <span className="block text-[11px] text-slate-400 mt-0.5">
            Sends a push near the end of each session in this package nudging you to write notes. Turn off for drop-in classes or anything that doesn&apos;t need a follow-up.
          </span>
        </span>
      </label>

      {/* ─── Group class ─────────────────────────────────────────── */}
      <label className="md:col-span-2 flex items-start gap-3 rounded-xl border border-slate-200 px-3 py-2.5 cursor-pointer">
        <input
          type="checkbox"
          checked={isGroup}
          onChange={e => setIsGroup(e.target.checked)}
          className="h-4 w-4 mt-0.5"
        />
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium text-slate-700">This is a group class</span>
          <span className="block text-[11px] text-slate-400 mt-0.5">
            Run cohorts of this package — one shared schedule, many clients, a roster and capacity. Leave off for normal 1:1 packages.
          </span>
        </span>
      </label>

      {isGroup && (
        <div className="md:col-span-2 rounded-xl border border-blue-100 bg-blue-50/40 p-3 flex flex-col gap-3">
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1.5">Capacity (optional)</label>
            <input
              type="number"
              min={0}
              value={capacity}
              onChange={e => setCapacity(e.target.value)}
              placeholder="Leave blank for unlimited"
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-[11px] text-slate-400 mt-1">Max enrolments per run. A run can override this.</p>
          </div>

          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={allowWaitlist} onChange={e => setAllowWaitlist(e.target.checked)} className="h-4 w-4 mt-0.5" />
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-medium text-slate-700">Allow a waitlist when full</span>
              <span className="block text-[11px] text-slate-400 mt-0.5">Auto-promotes the next person when someone withdraws.</span>
            </span>
          </label>

          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={allowDropIn} onChange={e => setAllowDropIn(e.target.checked)} className="h-4 w-4 mt-0.5" />
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-medium text-slate-700">Allow drop-ins after the class starts</span>
              <span className="block text-[11px] text-slate-400 mt-0.5">Clients can join mid-run, charged per remaining session.</span>
            </span>
          </label>

          {allowDropIn && (
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1.5">Drop-in price per session</label>
              <input
                type="text"
                inputMode="decimal"
                value={dropInPrice}
                onChange={e => setDropInPrice(e.target.value)}
                placeholder="30"
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          {PUBLIC_CLASS_ENROLLMENT_ENABLED && (
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={publicEnrollment} onChange={e => setPublicEnrollment(e.target.checked)} className="h-4 w-4 mt-0.5" />
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium text-slate-700">Let clients self-enrol from your embed form</span>
                <span className="block text-[11px] text-slate-400 mt-0.5">Open runs show publicly; requests arrive as enquiries for you to accept.</span>
              </span>
            </label>
          )}
        </div>
      )}

      {/* ─── Client self-booking ─────────────────────────────────── */}
      <label className="md:col-span-2 flex items-start gap-3 rounded-xl border border-slate-200 px-3 py-2.5 cursor-pointer">
        <input
          type="checkbox"
          checked={clientSelfBook}
          onChange={e => setClientSelfBook(e.target.checked)}
          className="h-4 w-4 mt-0.5"
        />
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium text-slate-700">Let clients self-book this from their availability tab</span>
          <span className="block text-[11px] text-slate-400 mt-0.5">
            Clients pick a start time from your real openings; the rest auto-place on the package cadence.
          </span>
        </span>
      </label>

      {clientSelfBook && (
        <label className="md:col-span-2 flex items-start gap-3 rounded-xl border border-blue-100 bg-blue-50/40 px-3 py-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={selfBookRequiresApproval}
            onChange={e => setSelfBookRequiresApproval(e.target.checked)}
            className="h-4 w-4 mt-0.5"
          />
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-medium text-slate-700">Require my approval before it&apos;s booked</span>
            <span className="block text-[11px] text-slate-400 mt-0.5">
              On: the client&apos;s pick is a request you confirm. Off: it books instantly onto your calendar.
            </span>
          </span>
        </label>
      )}

      <div className="md:col-span-2">
        <label className="text-sm font-medium text-slate-700 block mb-1.5">Schedule colour</label>
        <p className="text-[11px] text-slate-400 mb-1.5">Sessions assigned to this package will use this colour on the calendar. Leave blank to keep the default status colour.</p>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setColor(null)}
            className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-full border transition-colors ${
              color === null
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
            }`}
          >
            Default
          </button>
          {COLOR_OPTIONS.map(opt => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setColor(opt.id)}
              aria-label={opt.label}
              className={`h-7 w-7 rounded-full border-2 transition-all ${opt.swatch} ${color === opt.id ? 'border-slate-900 ring-2 ring-slate-300' : 'border-white shadow-sm hover:scale-110'}`}
            />
          ))}
        </div>
      </div>

      <div className="md:col-span-2 flex gap-2 pt-2">
        <Button type="submit" loading={isSubmitting}>{existing ? 'Save changes' : 'Create package'}</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  )
}
