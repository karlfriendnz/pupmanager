'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Copy, MoreHorizontal, Pencil, Shuffle, Trash2 } from 'lucide-react'
import { ActionSheet, type SheetAction } from '@/components/shared/action-sheet'
import { ConfirmSheet } from '@/components/shared/confirm-sheet'

/**
 * The controls for ONE offering, on its own detail screen: Edit, then More.
 *
 * Edit is the thing a trainer reaches for daily, so it stays a labelled button
 * in the card heading where it's found without hunting. Everything you do
 * occasionally — clone it, change what kind of offering it is, delete it — is
 * behind More, which opens the house-style sheet (full width off the bottom
 * edge on a phone, a small panel on desktop) rather than a menu hanging off the
 * corner.
 *
 * Every offering detail screen uses this one component: 1:1 sessions, group
 * classes, casual classes, daycare programmes and events. They used to
 * disagree — consults put Edit and Delete at the foot of the Details card while
 * classes and events put them in the page header — which is how Edit ended up
 * appearing twice on the same screen.
 *
 * Nothing here is new behaviour. The routes are the ones already in use:
 *   clone    POST   /api/packages/:packageId/clone
 *   convert  POST   /api/class-runs/:runId/convert  { to }   (between group kinds)
 *   delete   DELETE /api/class-runs/:runId  |  /api/packages/:packageId
 */
export function OfferingActions({
  name,
  noun,
  editHref,
  packageId,
  runId,
  runKind,
  backHref,
}: {
  /** The offering's name — titles the sheet and the confirmation. */
  name: string
  /** What to call it in prose: "class", "event", "package"… */
  noun: string
  editHref: string
  packageId: string
  /**
   * Present when this offering RUNS as a ClassRun (a class, casual class,
   * daycare programme or event). Its absence is what makes it a 1:1 session,
   * and it decides which way Convert goes and which route Delete calls.
   */
  runId?: string
  /**
   * Which group kind this run currently is. Decides which conversions to
   * offer — you are shown the other two, never the one you are already on.
   * Absent for a 1:1 session (no run) and for daycare, which converts nowhere.
   */
  runKind?: 'class' | 'casual' | 'event'
  /** Where to land once it's deleted or converted away. */
  backHref: string
}) {
  const router = useRouter()
  const [sheetOpen, setSheetOpen] = useState(false)
  // Two confirmations, one at a time: deleting, and converting a class (which
  // drops its scheduled sessions). Both are unrecoverable, so neither happens
  // on a single tap — and neither uses window.confirm, the one dialog a phone
  // renders worst.
  const [confirm, setConfirm] = useState<null | { kind: 'delete' } | { kind: 'convert'; to: 'class' | 'casual' | 'event'; label: string }>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isRun = !!runId

  // The three group kinds are the same two rows wearing different declared
  // flags, so a class can become a casual class or an event and back. Offered
  // as separate rows rather than one "Convert…" that opens a picker: three
  // named destinations read faster than a menu inside a menu, and there are
  // only ever two of them.
  //
  // NOT offered: 1:1. A run-backed offering converting to a 1:1 used to be the
  // only direction here, and the reverse stranded offerings on neither page —
  // /packages lists `isGroup: false`, /classes lists ClassRun rows, and nothing
  // creates a run. Group ↔ group has no such hole: the run already exists and
  // stays put.
  //
  // Daycare is not a target either. Day-parts and drop-in bookings are a
  // different shape and nobody has asked for it.
  const CONVERT_TARGETS = [
    { to: 'class' as const, label: 'group class', hint: 'A fixed series with a shared roster' },
    { to: 'casual' as const, label: 'casual class', hint: 'Clients book single sessions as drop-ins' },
    { to: 'event' as const, label: 'event', hint: 'A single occasion, sold on its own' },
  ]
  const convertOptions = isRun && runKind
    ? CONVERT_TARGETS.filter(t => t.to !== runKind)
    : []

  async function readError(res: Response, fallback: string) {
    const body = await res.json().catch(() => null) as { error?: unknown } | null
    return typeof body?.error === 'string' ? body.error : fallback
  }

  async function handleClone() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/packages/${packageId}/clone`, { method: 'POST' })
      const body = await res.json().catch(() => null) as { id?: string } | null
      if (res.ok && body?.id) {
        // Land on the copy's edit form — a clone is never finished as-is.
        router.push(`/packages/${body.id}/edit`)
        router.refresh()
        return
      }
      setError(await readError(res, `Could not copy this ${noun}.`))
    } finally {
      setBusy(false)
      setSheetOpen(false)
    }
  }

  async function handleConvert(to: 'class' | 'casual' | 'event') {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/class-runs/${runId}/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to }),
      })
      const body = await res.json().catch(() => null) as
        { href?: string; priceWarning?: string | null; error?: unknown } | null
      if (res.ok && body?.href) {
        // The kinds live under different sections, so this is a real move —
        // land them on the offering where it now lives, not where it was.
        // A price whose UNIT changed is carried, not recalculated, so say so
        // rather than let them find out from a client's bill.
        if (body.priceWarning) {
          try { sessionStorage.setItem('pm-offering-notice', body.priceWarning) } catch { /* private mode */ }
        }
        router.push(body.href)
        router.refresh()
        return
      }
      // The API refuses in prose — people booked in, money already invoiced,
      // an event that would have to be six events. Show what it said.
      setError(await readError(res, `Could not convert this ${noun}.`))
      setConfirm(null)
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = runId
        ? await fetch(`/api/class-runs/${runId}`, { method: 'DELETE' })
        : await fetch(`/api/packages/${packageId}`, { method: 'DELETE' })
      if (res.ok) {
        // refresh() first so the list re-renders without it — pushing alone can
        // serve the cached (stale) render.
        router.refresh()
        router.push(backHref)
        return
      }
      setError(await readError(res, `Could not delete this ${noun}.`))
      setConfirm(null)
    } finally {
      setBusy(false)
    }
  }

  const actions: SheetAction[] = [
    {
      key: 'clone',
      label: `Duplicate this ${noun}`,
      hint: 'Opens a copy for you to change',
      icon: <Copy className="h-5 w-5" strokeWidth={1.75} />,
      onSelect: handleClone,
      disabled: busy,
    },
    // One row per kind this could become — never the kind it already is.
    ...convertOptions.map(t => ({
      key: `convert-${t.to}`,
      label: `Convert to ${t.to === 'event' ? 'an' : 'a'} ${t.label}`,
      hint: t.hint,
      icon: <Shuffle className="h-5 w-5" strokeWidth={1.75} />,
      onSelect: () => { setSheetOpen(false); setConfirm({ kind: 'convert', to: t.to, label: t.label }) },
      disabled: busy,
    })),
    {
      key: 'delete',
      label: `Delete this ${noun}`,
      hint: 'Asks first — this can’t be undone',
      icon: <Trash2 className="h-5 w-5" strokeWidth={1.75} />,
      onSelect: () => { setSheetOpen(false); setConfirm({ kind: 'delete' }) },
      disabled: busy,
      danger: true,
    },
  ]

  return (
    <div className="flex items-center gap-1.5">
      {error && (
        <p role="alert" className="max-w-[16rem] truncate text-xs text-red-600" title={error}>{error}</p>
      )}
      <Link
        href={editHref}
        className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        <Pencil className="h-4 w-4 text-slate-500" strokeWidth={1.75} />
        Edit
      </Link>
      <button
        type="button"
        onClick={() => setSheetOpen(true)}
        aria-label={`More actions for this ${noun}`}
        aria-haspopup="dialog"
        className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
      >
        <MoreHorizontal className="h-4 w-4" strokeWidth={1.75} />
      </button>

      {sheetOpen && (
        <ActionSheet title={name} actions={actions} onClose={() => setSheetOpen(false)} />
      )}

      {confirm && (
        <ConfirmSheet
          title={confirm.kind === 'delete' ? `Delete “${name}”?` : `Convert to ${confirm.to === 'event' ? 'an' : 'a'} ${confirm.label}?`}
          body={confirm.kind === 'delete'
            ? `This ${noun} and everything on it goes. This can’t be undone.`
            : confirm.to === 'casual'
              ? `“${name}” becomes a casual class. Clients book single sessions, and the price becomes the price of ONE — check it before anyone books.`
              : confirm.to === 'event'
                ? `“${name}” becomes a one-off event, sold on its own.`
                : `“${name}” becomes a group class — a fixed series with a shared roster.`}
          confirmLabel={confirm.kind === 'delete' ? 'Delete' : 'Convert'}
          danger={confirm.kind === 'delete'}
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={confirm.kind === 'delete' ? handleDelete : () => handleConvert(confirm.to)}
        />
      )}
    </div>
  )
}
