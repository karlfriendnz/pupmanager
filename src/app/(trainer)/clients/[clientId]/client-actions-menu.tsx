'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  MoreVertical, Pencil, Eye, Send, Package as PackageIcon,
  Share2, Trash2, X, Loader2, Check, AlertCircle,
} from 'lucide-react'
import { ShareClientModal } from './share-client-modal'
import { AssignPackageButton } from './assign-package-modal'

interface PkgOption {
  id: string
  name: string
  description: string | null
  sessionCount: number
  weeksBetween: number
  durationMins: number
  sessionType: 'IN_PERSON' | 'VIRTUAL'
}

interface AvailabilityRow {
  id: string
  dayOfWeek: number | null
  date: string | null
  startTime: string
  endTime: string
}

interface Props {
  clientId: string
  clientName: string
  /** Email the re-invite will be sent to — surfaced inside the
   *  confirm dialog so the trainer can sanity-check before
   *  triggering an outbound send. */
  clientEmail: string
  /** True when the client hasn't activated their account yet — the
   *  menu copy reads "Re-invite client" in that case and "Re-send
   *  sign-in link" once they're verified. The action itself is
   *  available for both. */
  needsInvite: boolean
  packages: PkgOption[]
  availability: AvailabilityRow[]
  dogs: { id: string; name: string }[]
  /** Whether the trainer can perform editing actions (false for
   *  read-only co-managers). When false the menu becomes a plain
   *  "View as client" button — that's the only action they have. */
  canEdit: boolean
  /** Whether this trainer is the primary trainer (some actions —
   *  Share + Delete — only make sense for the primary). */
  isPrimaryTrainer: boolean
}

// Single dropdown that consolidates every per-client action: Edit,
// View as client, Re-invite, Assign package, Share, Delete. Replaces
// the row of buttons that used to crowd the client profile header so
// the layout works on phone-narrow viewports without wrapping.
//
// Mobile-friendly:
//  - 44px+ tap targets per item
//  - tap-anywhere-outside or hit Escape to close
//  - menu is right-aligned + width-clamped so it never overflows the
//    viewport on narrow screens
//
// State machine for the modals: only one can be open at a time. Each
// item sets `activeModal` to its own kind; the controlled
// ShareClientModal / AssignPackageButton render based on that value.
// Re-invite has its own inline status (sending → sent → idle) so it
// never blocks the menu.
type ModalKind = null | 'assign' | 'share' | 'delete' | 'reinvite'
type ReinviteState =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent' }
  | { kind: 'error'; message: string }

export function ClientActionsMenu({
  clientId, clientName, clientEmail, needsInvite, packages, availability, dogs,
  canEdit, isPrimaryTrainer,
}: Props) {
  const router = useRouter()
  const [menuOpen, setMenuOpen] = useState(false)
  const [activeModal, setActiveModal] = useState<ModalKind>(null)
  const [reinvite, setReinvite] = useState<ReinviteState>({ kind: 'idle' })
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  // Click-outside + Escape — same pattern the trainer-shell user
  // popout uses, kept inside this component so the menu is fully
  // self-contained.
  useEffect(() => {
    if (!menuOpen) return
    function onPointer(ev: MouseEvent | TouchEvent) {
      if (!wrapperRef.current) return
      if (!wrapperRef.current.contains(ev.target as Node)) setMenuOpen(false)
    }
    function onKey(ev: KeyboardEvent) {
      if (ev.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('touchstart', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('touchstart', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  // Co-managers (canEdit=false) just get the View-as-client link —
  // there's nothing to consolidate so no dropdown is rendered.
  if (!canEdit) {
    return (
      <Link
        href={`/preview-as/${clientId}`}
        target="_blank"
        rel="noopener"
        className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
      >
        <Eye className="h-4 w-4" /> View as client
      </Link>
    )
  }

  async function handleReinvite() {
    setReinvite({ kind: 'sending' })
    try {
      const res = await fetch(`/api/clients/${clientId}/reinvite`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Could not send invite')
      setActiveModal(null)
      setReinvite({ kind: 'sent' })
      setTimeout(() => setReinvite({ kind: 'idle' }), 6000)
    } catch (err) {
      setReinvite({ kind: 'error', message: err instanceof Error ? err.message : 'Send failed' })
    }
  }

  async function handleDelete() {
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Could not delete this client')
      router.push('/clients')
      router.refresh()
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Delete failed')
      setDeleteBusy(false)
    }
  }

  return (
    <div ref={wrapperRef} className="relative inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => setMenuOpen(v => !v)}
        aria-label="Client actions"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-white border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        <MoreVertical className="h-4 w-4" />
        Actions
      </button>

      {menuOpen && (
        <div
          role="menu"
          className="absolute right-0 top-11 z-40 w-64 rounded-2xl bg-white shadow-[0_18px_45px_-12px_rgba(15,23,42,0.25)] border border-slate-100 overflow-hidden"
        >
          <MenuLink
            href={`/clients/${clientId}/edit`}
            icon={<Pencil className="h-4 w-4 text-slate-400" />}
            label="Edit details"
            onClick={() => setMenuOpen(false)}
          />
          <MenuLink
            href={`/preview-as/${clientId}`}
            icon={<Eye className="h-4 w-4 text-slate-400" />}
            label="View as client"
            target="_blank"
            onClick={() => setMenuOpen(false)}
          />
          <MenuButton
            icon={<Send className="h-4 w-4 text-slate-400" />}
            label={needsInvite ? 'Re-invite client' : 'Re-send sign-in link'}
            onClick={() => {
              setMenuOpen(false)
              // Reset any previous error so the confirm dialog opens
              // clean — error from a prior attempt would otherwise
              // sit at the bottom of the menu trigger.
              setReinvite({ kind: 'idle' })
              setActiveModal('reinvite')
            }}
          />
          <MenuButton
            icon={<PackageIcon className="h-4 w-4 text-slate-400" />}
            label="Assign package"
            onClick={() => { setMenuOpen(false); setActiveModal('assign') }}
          />
          {isPrimaryTrainer && (
            <MenuButton
              icon={<Share2 className="h-4 w-4 text-slate-400" />}
              label="Share with another trainer"
              onClick={() => { setMenuOpen(false); setActiveModal('share') }}
            />
          )}
          {isPrimaryTrainer && (
            <MenuButton
              icon={<Trash2 className="h-4 w-4 text-red-500" />}
              label="Delete client"
              destructive
              onClick={() => { setMenuOpen(false); setActiveModal('delete') }}
            />
          )}
        </div>
      )}

      {/* Inline reinvite status — sits below the trigger, never blocks
          subsequent menu interactions. */}
      {reinvite.kind === 'sending' && (
        <p className="text-xs text-slate-500 inline-flex items-center gap-1">
          <Loader2 className="h-3 w-3 animate-spin" /> Re-sending invite…
        </p>
      )}
      {reinvite.kind === 'sent' && (
        <p className="text-xs text-emerald-600 inline-flex items-center gap-1">
          <Check className="h-3 w-3" /> Invite re-sent
        </p>
      )}
      {reinvite.kind === 'error' && (
        <p className="text-[11px] text-red-600 inline-flex items-center gap-1 max-w-[16rem] text-right">
          <AlertCircle className="h-3 w-3 shrink-0" />
          <span>{reinvite.message}</span>
        </p>
      )}

      {/* Controlled modals. AssignPackageButton + ShareClientModal
          accept open/onOpenChange now, so the menu owns their state. */}
      <AssignPackageButton
        clientId={clientId}
        packages={packages}
        availability={availability}
        dogs={dogs}
        open={activeModal === 'assign'}
        onOpenChange={v => setActiveModal(v ? 'assign' : null)}
      />
      <ShareClientModal
        clientId={clientId}
        clientName={clientName}
        open={activeModal === 'share'}
        onOpenChange={v => setActiveModal(v ? 'share' : null)}
      />

      {/* Re-invite confirm — surfaces the recipient email so the
          trainer can spot a typo before triggering an outbound send.
          Copy adapts based on whether the client has activated yet:
          unactivated → "send invite", activated → "send sign-in link"
          (same mechanism either way, different framing for the
          trainer's mental model). */}
      {activeModal === 'reinvite' && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
          onClick={() => reinvite.kind !== 'sending' && setActiveModal(null)}
        >
          <div
            className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-5"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 mb-2">
              <h2 className="text-base font-semibold text-slate-900">
                {needsInvite
                  ? `Re-send invite to ${clientName}?`
                  : `Send a fresh sign-in link to ${clientName}?`}
              </h2>
              <button
                type="button"
                onClick={() => reinvite.kind !== 'sending' && setActiveModal(null)}
                aria-label="Close"
                className="text-slate-400 hover:text-slate-600 -mr-1 -mt-1 p-1"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-sm text-slate-600 leading-snug">
              We&apos;ll email a fresh{' '}
              {needsInvite ? 'sign-up' : 'sign-in'} link to{' '}
              <span className="font-medium text-slate-900">{clientEmail}</span>.{' '}
              {needsInvite
                ? 'Any previous invite link they had will stop working.'
                : 'You can send this as often as you like — each new link replaces the previous one.'}
            </p>
            {reinvite.kind === 'error' && (
              <p className="mt-3 text-xs text-red-600 inline-flex items-center gap-1">
                <AlertCircle className="h-3 w-3" /> {reinvite.message}
              </p>
            )}
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                disabled={reinvite.kind === 'sending'}
                className="text-sm font-medium px-3 py-2 rounded-lg text-slate-600 hover:bg-slate-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleReinvite}
                disabled={reinvite.kind === 'sending'}
                className="inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {reinvite.kind === 'sending'
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Sending…</>
                  : <><Send className="h-4 w-4" /> Yes, re-send</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm — stays in the menu's own component because
          it's small, destructive, and should look in-place rather
          than punt to a full-screen modal. */}
      {activeModal === 'delete' && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
          onClick={() => !deleteBusy && setActiveModal(null)}
        >
          <div
            className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-5"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 mb-2">
              <h2 className="text-base font-semibold text-slate-900">Delete {clientName}?</h2>
              <button
                type="button"
                onClick={() => !deleteBusy && setActiveModal(null)}
                aria-label="Close"
                className="text-slate-400 hover:text-slate-600 -mr-1 -mt-1 p-1"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-sm text-slate-600 leading-snug">
              Their account stays in PupManager but you&apos;ll lose access. Past sessions
              they had with you are kept on file (visible only to you, marked as
              orphaned). This can&apos;t be undone.
            </p>
            {deleteError && (
              <p className="mt-3 text-xs text-red-600 inline-flex items-center gap-1">
                <AlertCircle className="h-3 w-3" /> {deleteError}
              </p>
            )}
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                disabled={deleteBusy}
                className="text-sm font-medium px-3 py-2 rounded-lg text-slate-600 hover:bg-slate-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleteBusy}
                className="inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
              >
                {deleteBusy
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Deleting…</>
                  : <><Trash2 className="h-4 w-4" /> Yes, delete</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Menu primitives ────────────────────────────────────────────────

function MenuLink({
  href, icon, label, target, onClick,
}: {
  href: string
  icon: React.ReactNode
  label: string
  target?: '_blank'
  onClick?: () => void
}) {
  return (
    <Link
      href={href}
      target={target}
      rel={target === '_blank' ? 'noopener' : undefined}
      onClick={onClick}
      className="flex items-center gap-3 w-full px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
      role="menuitem"
    >
      {icon}
      {label}
    </Link>
  )
}

function MenuButton({
  icon, label, onClick, destructive,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  destructive?: boolean
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex items-center gap-3 w-full px-4 py-3 text-sm transition-colors ${
        destructive ? 'text-red-600 hover:bg-red-50' : 'text-slate-700 hover:bg-slate-50'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}
