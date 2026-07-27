'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Copy, MoreHorizontal, Pencil, Shuffle, Trash2 } from 'lucide-react'
import { ActionSheet, type SheetAction } from '@/components/shared/action-sheet'
import { ModalPortal } from '@/components/shared/modal-portal'

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
 * Every offering detail screen uses this one component: 1:1 consults, group
 * classes, casual classes, daycare programmes and events. They used to
 * disagree — consults put Edit and Delete at the foot of the Details card while
 * classes and events put them in the page header — which is how Edit ended up
 * appearing twice on the same screen.
 *
 * Nothing here is new behaviour. The routes are the ones already in use:
 *   clone    POST   /api/packages/:packageId/clone
 *   convert  POST   /api/class-runs/:runId/convert-to-package   (class → 1:1)
 *            PATCH  /api/packages/:packageId { isGroup: true }  (1:1 → class)
 *   delete   DELETE /api/class-runs/:runId  |  /api/packages/:packageId
 */
export function OfferingActions({
  name,
  noun,
  editHref,
  packageId,
  runId,
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
   * daycare programme or event). Its absence is what makes it a 1:1 consult,
   * and it decides which way Convert goes and which route Delete calls.
   */
  runId?: string
  /** Where to land once it's deleted or converted away. */
  backHref: string
}) {
  const router = useRouter()
  const [sheetOpen, setSheetOpen] = useState(false)
  // Two confirmations, one at a time: deleting, and converting a class (which
  // drops its scheduled sessions). Both are unrecoverable, so neither happens
  // on a single tap — and neither uses window.confirm, the one dialog a phone
  // renders worst.
  const [confirm, setConfirm] = useState<null | 'delete' | 'convert'>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isRun = !!runId
  const convertLabel = isRun ? 'Convert to a 1:1 consult' : 'Convert to a group class'
  const convertHint = isRun
    ? 'Removes the scheduled sessions and keeps the offering'
    : 'Run it as a class with a shared roster instead'

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

  async function handleConvert() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = runId
        ? await fetch(`/api/class-runs/${runId}/convert-to-package`, { method: 'POST' })
        : await fetch(`/api/packages/${packageId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isGroup: true }),
          })
      if (res.ok) {
        // Either direction lands on the offering's edit form: converting a
        // class leaves a 1:1 consult with nothing scheduled, and converting a
        // consult leaves a class with no day or time yet.
        router.push(`/packages/${packageId}/edit`)
        router.refresh()
        return
      }
      // The APIs refuse politely when people are booked in or assigned, and
      // their message says exactly who — show it rather than a generic line.
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
    {
      key: 'convert',
      label: convertLabel,
      hint: convertHint,
      icon: <Shuffle className="h-5 w-5" strokeWidth={1.75} />,
      onSelect: () => { setSheetOpen(false); setConfirm('convert') },
      disabled: busy,
    },
    {
      key: 'delete',
      label: `Delete this ${noun}`,
      hint: 'Asks first — this can’t be undone',
      icon: <Trash2 className="h-5 w-5" strokeWidth={1.75} />,
      onSelect: () => { setSheetOpen(false); setConfirm('delete') },
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
          title={confirm === 'delete' ? `Delete “${name}”?` : convertLabel}
          body={confirm === 'delete'
            ? `This ${noun} and everything on it goes. This can’t be undone.`
            : isRun
              ? `“${name}” becomes a 1:1 consult and its scheduled sessions are removed. This can’t be undone.`
              : `“${name}” becomes a group class with a shared roster. You’ll set the day and time next.`}
          confirmLabel={confirm === 'delete' ? 'Delete' : 'Convert'}
          danger={confirm === 'delete'}
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={confirm === 'delete' ? handleDelete : handleConvert}
        />
      )}
    </div>
  )
}

/**
 * A yes/no in the same shell as the sheet above it — same portal, same body
 * scroll lock, same Escape and click-out. Kept local: it exists because a
 * destructive choice deserves a full sentence, which a menu row has no room
 * for.
 */
function ConfirmSheet({
  title, body, confirmLabel, danger, busy, onCancel, onConfirm,
}: {
  title: string
  body: string
  confirmLabel: string
  danger?: boolean
  busy?: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <ModalPortal>
      <ConfirmShell onCancel={onCancel}>
        <div
          role="alertdialog"
          aria-modal="true"
          aria-label={title}
          className="relative w-full rounded-t-2xl border border-slate-200 bg-white p-5 shadow-xl sm:max-w-sm sm:rounded-2xl"
          style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom, 0px))' }}
        >
          <p className="text-sm font-semibold text-slate-900">{title}</p>
          <p className="mt-1.5 text-sm text-slate-600">{body}</p>
          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-xl px-3 py-2 text-sm font-medium text-slate-500 hover:text-slate-700"
            >
              Keep it
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy}
              className={`rounded-xl border px-3 py-2 text-sm font-semibold disabled:opacity-50 ${
                danger
                  ? 'border-red-200 text-red-600 hover:bg-red-50'
                  : 'border-slate-200 text-slate-800 hover:bg-slate-50'
              }`}
            >
              {busy ? 'Working…' : confirmLabel}
            </button>
          </div>
        </div>
      </ConfirmShell>
    </ModalPortal>
  )
}

function ConfirmShell({ children, onCancel }: { children: React.ReactNode; onCancel: () => void }) {
  // Body scroll stays locked while this is up, so there's never a second rail;
  // Escape and a tap on the backdrop both back out.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [onCancel])

  return (
    <div className="fixed inset-0 z-[95] flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onCancel} aria-hidden />
      {children}
    </div>
  )
}
