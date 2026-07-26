'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Pencil, Eye, Send, Package as PackageIcon,
  Share2, Trash2, X, Loader2, AlertCircle, ChevronRight,
  type LucideIcon,
} from 'lucide-react'
import { ShareClientModal } from './share-client-modal'
import { AssignPackageButton, type ClassOption } from './assign-package-modal'
import { ModalPortal } from '@/components/shared/modal-portal'
import { FlatBlock, FlatRow, SectionLabel } from '@/components/shared/flat-list'
import { useIsNative } from '@/lib/native'
import { cn } from '@/lib/utils'

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
   *  row copy reads "Re-invite client" in that case and "Re-send
   *  sign-in link" once they're verified. The action itself is
   *  available for both. */
  needsInvite: boolean
  packages: PkgOption[]
  classes?: ClassOption[]
  availability: AvailabilityRow[]
  dogs: { id: string; name: string }[]
  /** Staff members in the business + the logged-in user's membership id.
   *  Drive the optional "Assigned trainer" picker in the assign-package modal
   *  (hidden unless the business has more than one member). */
  members?: { id: string; name: string; role: string; title?: string | null }[]
  currentMembershipId?: string | null
  /** Whether the trainer can perform editing actions (false for
   *  read-only co-managers). When false the block shrinks to a single
   *  "View as client" row — that's the only action they have. */
  canEdit: boolean
  /** Whether this trainer is the primary trainer (some actions —
   *  Share + Delete — only make sense for the primary). */
  isPrimaryTrainer: boolean
  /** Client app add-on on — gates the preview + re-invite actions. */
  clientAppEnabled: boolean
}

// Every per-client action — Edit, View as client, Re-invite, Assign consult,
// Share, Delete — as rows ON the page, at the foot of the Overview tab.
//
// This replaces the "Actions" dropdown that used to sit in the page header.
// That dropdown itself replaced a ROW OF HEADER BUTTONS, which wrapped badly on
// a phone, so it is deliberately NOT a row of buttons that came back: it is the
// house flat block — one bordered surface, hairline dividers, plain line icons,
// 44px+ tap targets — which stacks vertically and can't wrap. Overview is the
// default tab, so nothing is behind a trigger any more.
//
// Delete sits in its OWN block below the others, red text on a plain row rather
// than a filled button, so a destructive action can't be mistaken for a
// neighbour of "Edit details".
//
// State machine for the modals: only one can be open at a time. Each row sets
// `activeModal` to its own kind; the controlled ShareClientModal /
// AssignPackageButton render based on that value. Re-invite reports its
// sending → sent → error state on its own row's second line so it never
// blocks anything else.
type ModalKind = null | 'assign' | 'share' | 'delete' | 'reinvite'
type ReinviteState =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent' }
  | { kind: 'error'; message: string }

// The house row shape, borrowed from FlatRow for the two rows FlatRow can't
// express: an external-target link and a destructive row.
const ROW_CLS = 'flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-slate-50'

function RowInner({ icon: Icon, label, tone }: { icon: LucideIcon; label: string; tone?: 'danger' }) {
  const danger = tone === 'danger'
  return (
    <>
      <Icon
        className={cn('h-[18px] w-[18px] flex-shrink-0', danger ? 'text-red-600' : 'text-slate-700')}
        strokeWidth={1.75}
      />
      <span className={cn(
        'min-w-0 flex-1 truncate text-sm font-medium',
        danger ? 'text-red-600' : 'text-slate-900',
      )}>
        {label}
      </span>
      <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-400" />
    </>
  )
}

export function ClientActionsPanel({
  clientId, clientName, clientEmail, needsInvite, packages, classes = [], availability, dogs,
  members = [], currentMembershipId = null,
  canEdit, isPrimaryTrainer, clientAppEnabled,
}: Props) {
  const router = useRouter()
  // In the native app, target="_blank" links are handed to the OS browser
  // (Safari/Chrome), which has no app session — so "View as client" would land
  // on the login screen. Navigate in the same WebView there to keep the session
  // (the preview banner's "Exit preview" brings the trainer back).
  const native = useIsNative()
  const previewTarget = native ? undefined : '_blank'
  const [activeModal, setActiveModal] = useState<ModalKind>(null)
  const [reinvite, setReinvite] = useState<ReinviteState>({ kind: 'idle' })
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // Never two scrollbars: while a confirm dialog is up, the page behind it
  // must not scroll (AGENTS.md, standing rule).
  const confirmOpen = activeModal === 'reinvite' || activeModal === 'delete'
  useEffect(() => {
    if (!confirmOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [confirmOpen])

  const viewAsClient = (
    <Link
      href={`/preview-as/${clientId}`}
      target={previewTarget}
      rel={previewTarget === '_blank' ? 'noopener' : undefined}
      className={ROW_CLS}
    >
      <RowInner icon={Eye} label="View as client" />
    </Link>
  )

  // Co-managers (canEdit=false) get the View-as-client row and nothing else —
  // the actions below it are ones they aren't allowed to perform.
  if (!canEdit) {
    return (
      <section aria-label="Client actions">
        <SectionLabel>Client actions</SectionLabel>
        <FlatBlock>{viewAsClient}</FlatBlock>
      </section>
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

  // The assign modal renders nothing when there's nothing to assign, so the
  // row would be a dead tap. Hide it instead — same gate the old menu comment
  // in assign-package-modal.tsx asked its caller to apply.
  const canAssign = packages.length > 0 || classes.length > 0

  const reinviteSub =
    reinvite.kind === 'sending' ? <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Re-sending invite…</span>
    : reinvite.kind === 'sent' ? <span className="text-emerald-600">Invite re-sent</span>
    : reinvite.kind === 'error' ? <span className="text-red-600">{reinvite.message}</span>
    : undefined

  return (
    <section aria-label="Client actions" className="flex flex-col gap-3">
      <div>
        <SectionLabel>Client actions</SectionLabel>
        <FlatBlock>
          <FlatRow
            icon={Pencil}
            label="Edit details"
            href={`/clients/${clientId}/edit`}
          />
          {/* Client-app-only actions (preview + re-invite) — hidden when the
              Client app add-on is off. */}
          {clientAppEnabled && viewAsClient}
          {clientAppEnabled && (
            <FlatRow
              icon={Send}
              label={needsInvite ? 'Re-invite client' : 'Re-send sign-in link'}
              sub={reinviteSub}
              onClick={() => {
                // Reset any previous error so the confirm dialog opens clean.
                setReinvite({ kind: 'idle' })
                setActiveModal('reinvite')
              }}
            />
          )}
          {canAssign && (
            <FlatRow
              icon={PackageIcon}
              label="Assign consult"
              onClick={() => setActiveModal('assign')}
            />
          )}
          {isPrimaryTrainer && (
            <FlatRow
              icon={Share2}
              label="Share with another trainer"
              onClick={() => setActiveModal('share')}
            />
          )}
        </FlatBlock>
      </div>

      {/* Delete stands alone, one block down — plain row, red text, no filled
          button competing with the actions above it. */}
      {isPrimaryTrainer && (
        <FlatBlock>
          <button type="button" onClick={() => setActiveModal('delete')} className={ROW_CLS}>
            <RowInner icon={Trash2} label="Delete client" tone="danger" />
          </button>
        </FlatBlock>
      )}

      {/* Controlled modals. AssignPackageButton + ShareClientModal accept
          open/onOpenChange, so this panel owns their state. */}
      <AssignPackageButton
        clientId={clientId}
        packages={packages}
        classes={classes}
        availability={availability}
        dogs={dogs}
        members={members}
        currentMembershipId={currentMembershipId}
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
        <ModalPortal>
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
        </ModalPortal>
      )}

      {/* Delete confirm — stays in this component because it's small,
          destructive, and should look in-place rather than punt to a
          full-screen modal. */}
      {activeModal === 'delete' && (
        <ModalPortal>
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
        </ModalPortal>
      )}
    </section>
  )
}
