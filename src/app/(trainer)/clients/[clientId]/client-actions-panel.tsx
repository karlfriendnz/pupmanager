'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Pencil, Eye, Send, Package as PackageIcon,
  Share2, Trash2, MoreHorizontal,
} from 'lucide-react'
import { ShareClientModal } from './share-client-modal'
import { AssignPackageButton, type ClassOption } from './assign-package-modal'
import { ActionSheet, type SheetAction } from '@/components/shared/action-sheet'
import { ConfirmSheet } from '@/components/shared/confirm-sheet'
import { Button } from '@/components/ui/button'
import { useIsNative } from '@/lib/native'
import type { PackageBookingWindow } from '@/lib/package-booking-window'

interface PkgOption {
  id: string
  name: string
  description: string | null
  sessionCount: number
  weeksBetween: number
  durationMins: number
  sessionType: 'IN_PERSON' | 'VIRTUAL'
  bufferMins?: number
  /** When this offering runs — steers where the assign modal places sessions. */
  bookingWindow?: PackageBookingWindow
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
   *  confirm sheet so the trainer can sanity-check before
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
   *  read-only co-managers). When false the menu shrinks to a single
   *  "View as client" — that's the only action they have. */
  canEdit: boolean
  /** Whether this trainer is the primary trainer (some actions —
   *  Share + Delete — only make sense for the primary). */
  isPrimaryTrainer: boolean
  /** Client app add-on on — gates the preview + re-invite actions. */
  clientAppEnabled: boolean
}

/**
 * One visible action, and a ⋯ for the rest.
 *
 * This was a two-up grid of five named rows plus a full-width Delete, at the
 * head of the Overview tab — fourteen tap targets on a screen that said nothing
 * about the client (Karl, 2026-08-06: "this is way too intense from a ux
 * perspective… lets get creative"; then "I think we can also put some things
 * under a ... menu like delete, view as, edit, share etc").
 *
 * **Assign stays out.** Not because it was the fifth in the list, but because
 * booking this client's next session is the thing a trainer comes to this
 * screen to DO — and the screen is now immersive, so the global "+" that was
 * the other way to start one is gone while you are on it. Burying it would
 * leave a phone with no one-tap route to book the client whose record is open.
 *
 * **Everything else is occasional.** Editing their details, previewing their
 * app, re-sending a sign-in link, sharing them with another business: weeks
 * apart, each. They go in the house ActionSheet — a full-width sheet off the
 * bottom edge, not a 56px menu hanging off a corner.
 *
 * **Delete is last, red, and behind a separator** (ActionSheet's own `danger`
 * treatment adds a thick rule above it, so it can't be caught by momentum on
 * the way down the list), and then behind a ConfirmSheet on top of that. The
 * re-invite confirms too — it sends a real email to a real person.
 */
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
  const [menuOpen, setMenuOpen] = useState(false)
  const [modal, setModal] = useState<null | 'assign' | 'share'>(null)
  const [confirm, setConfirm] = useState<null | 'reinvite' | 'delete'>(null)
  const [busy, setBusy] = useState(false)
  // One line under the bar for whatever the last action had to say. The sheet
  // has closed by then, so an error has nowhere else to land.
  const [note, setNote] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  function openPreview() {
    const href = `/preview-as/${clientId}`
    if (native) router.push(href)
    else window.open(href, '_blank', 'noopener')
  }

  async function handleReinvite() {
    setBusy(true)
    setNote(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/reinvite`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Could not send invite')
      setConfirm(null)
      setNote({ tone: 'ok', text: 'Invite re-sent.' })
    } catch (err) {
      setConfirm(null)
      setNote({ tone: 'error', text: err instanceof Error ? err.message : 'Send failed' })
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    setBusy(true)
    setNote(null)
    try {
      const res = await fetch(`/api/clients/${clientId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Could not delete this client')
      router.push('/clients')
      router.refresh()
    } catch (err) {
      setConfirm(null)
      setNote({ tone: 'error', text: err instanceof Error ? err.message : 'Delete failed' })
      setBusy(false)
    }
  }

  // The assign modal renders nothing when there's nothing to assign, so the
  // button would be a dead tap. Hide it instead.
  const canAssign = canEdit && (packages.length > 0 || classes.length > 0)

  const menu: SheetAction[] = [
    ...(canEdit ? [{
      key: 'edit',
      label: 'Edit details',
      icon: <Pencil className="h-[18px] w-[18px]" strokeWidth={1.75} />,
      onSelect: () => router.push(`/clients/${clientId}/edit`),
    }] : []),
    // Client-app-only actions (preview + re-invite) — hidden when the Client
    // app add-on is off. Preview is the ONE thing a read-only co-manager can do.
    ...(clientAppEnabled ? [{
      key: 'preview',
      label: 'View as client',
      hint: 'Opens their app as they see it',
      icon: <Eye className="h-[18px] w-[18px]" strokeWidth={1.75} />,
      onSelect: openPreview,
    }] : []),
    ...(canEdit && clientAppEnabled ? [{
      key: 'reinvite',
      label: needsInvite ? 'Re-invite client' : 'Re-send sign-in link',
      hint: clientEmail || undefined,
      icon: <Send className="h-[18px] w-[18px]" strokeWidth={1.75} />,
      onSelect: () => setConfirm('reinvite'),
    }] : []),
    ...(canEdit && isPrimaryTrainer ? [{
      key: 'share',
      label: 'Share with another trainer',
      icon: <Share2 className="h-[18px] w-[18px]" strokeWidth={1.75} />,
      onSelect: () => setModal('share'),
    }] : []),
    ...(canEdit && isPrimaryTrainer ? [{
      key: 'delete',
      label: 'Delete client',
      hint: 'You lose access — their account stays',
      icon: <Trash2 className="h-[18px] w-[18px]" strokeWidth={1.75} />,
      danger: true,
      onSelect: () => setConfirm('delete'),
    }] : []),
  ]

  // Nothing to offer at all (a read-only co-manager with the client app off).
  if (!canAssign && menu.length === 0) return null

  return (
    <section aria-label="Client actions" className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {canAssign && (
          <Button
            onClick={() => setModal('assign')}
            className="h-11 flex-1 md:flex-none md:px-5"
          >
            <PackageIcon className="h-4 w-4" strokeWidth={1.75} />
            Assign 1:1 session
          </Button>
        )}
        {menu.length > 0 && (
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label={`More actions for ${clientName}`}
            aria-haspopup="dialog"
            className="ml-auto inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
          >
            <MoreHorizontal className="h-5 w-5" strokeWidth={1.75} />
          </button>
        )}
      </div>

      {note && (
        <p
          role="status"
          className={note.tone === 'error' ? 'text-xs font-medium text-red-600' : 'text-xs font-medium text-emerald-600'}
        >
          {note.text}
        </p>
      )}

      {menuOpen && (
        <ActionSheet
          title={clientName}
          // Picking anything closes the sheet first — Delete opens a confirm of
          // its own, which would otherwise appear BEHIND it.
          actions={menu.map(a => ({ ...a, onSelect: () => { setMenuOpen(false); a.onSelect() } }))}
          onClose={() => setMenuOpen(false)}
        />
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
        open={modal === 'assign'}
        onOpenChange={v => setModal(v ? 'assign' : null)}
      />
      <ShareClientModal
        clientId={clientId}
        clientName={clientName}
        open={modal === 'share'}
        onOpenChange={v => setModal(v ? 'share' : null)}
      />

      {/* Re-invite names the recipient before sending — a typo is catchable
          only up to the moment a real email leaves. */}
      {confirm === 'reinvite' && (
        <ConfirmSheet
          title={needsInvite ? `Re-send invite to ${clientName}?` : `Send a fresh sign-in link to ${clientName}?`}
          body={`We'll email a fresh ${needsInvite ? 'sign-up' : 'sign-in'} link to ${clientEmail}. ${
            needsInvite
              ? 'Any previous invite link they had will stop working.'
              : 'You can send this as often as you like — each new link replaces the previous one.'
          }`}
          confirmLabel="Yes, re-send"
          busy={busy}
          onCancel={() => !busy && setConfirm(null)}
          onConfirm={handleReinvite}
        />
      )}

      {confirm === 'delete' && (
        <ConfirmSheet
          title={`Delete ${clientName}?`}
          body="Their account stays in PupManager but you'll lose access. Past sessions they had with you are kept on file (visible only to you, marked as orphaned). This can't be undone."
          confirmLabel="Yes, delete"
          danger
          busy={busy}
          onCancel={() => !busy && setConfirm(null)}
          onConfirm={handleDelete}
        />
      )}
    </section>
  )
}
