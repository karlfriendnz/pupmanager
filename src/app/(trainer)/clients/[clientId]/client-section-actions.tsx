'use client'

import { useState, type ReactNode } from 'react'
import { CalendarPlus, Receipt } from 'lucide-react'
import { EditScreen } from '@/components/shared/edit-screen'
import { SaleComposer } from '@/components/shared/sale-composer'
import { AssignPackageButton, type ClassOption } from './assign-package-modal'
import type { PackageBookingWindow } from '@/lib/package-booking-window'

/**
 * A section page is where a trainer DOES that thing, not just reads it (Karl,
 * 2026-08-06: "we need to have actions on pages").
 *
 * The bar is `EditScreen` — the house pinned-action layout, already used by the
 * product form and the offering detail screens. Its own comment covers the read
 * case: "A READ screen — an offering, seen rather than edited — has 'Edit' as
 * its primary action and no Cancel at all; the way out is the back arrow." That
 * is exactly the shape of a section page, so it is reused rather than a third
 * pinned bar being written.
 *
 * The two wrappers here exist because their action opens a MODAL and therefore
 * needs state. A section whose action is a plain navigation (Dogs → the edit
 * form, Details → the edit form, Comms → the message thread) renders EditScreen
 * straight from the server page with `primary.href` and needs nothing here.
 *
 * Three sections deliberately carry NO action, because inventing one to fill
 * the bar would be worse than an empty bar:
 *   · Notes — its Save is already on the page, and it is the only thing to do
 *   · Training log — the CLIENT writes practice logs; a trainer comments on
 *     them in place and cannot create one
 *   · Achievements — every badge row carries its own Award button
 */

interface AssignProps {
  clientId: string
  packages: {
    id: string
    name: string
    description: string | null
    sessionCount: number
    weeksBetween: number
    durationMins: number
    sessionType: 'IN_PERSON' | 'VIRTUAL'
    bufferMins?: number
    bookingWindow?: PackageBookingWindow
  }[]
  classes: ClassOption[]
  availability: { id: string; dayOfWeek: number | null; date: string | null; startTime: string; endTime: string }[]
  dogs: { id: string; name: string }[]
  members: { id: string; name: string; role: string }[]
  currentMembershipId: string | null
}

/**
 * Sessions, with "Book a session" pinned to the foot.
 *
 * It opens `AssignPackageButton` — the SAME flow the client profile's Assign
 * action opens, the same component instance shape, the same routes. Karl asked
 * for the client's own booking wizard here; see the note in
 * `[section]/page.tsx` for why that is a separate piece of work and why two
 * paths that both create sessions would be the wrong answer in the meantime.
 */
export function ClientSessionsScreen({
  assign,
  canAssign,
  children,
}: {
  assign: AssignProps
  /** False for a read-only co-manager, or a trainer with nothing to assign. */
  canAssign: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)

  if (!canAssign) return <>{children}</>

  return (
    <EditScreen
      primary={{
        // The SAME words as the profile's button, because it is the same flow
        // and the same modal — two names for one action is how a trainer ends
        // up believing there are two ways to book.
        label: 'Assign 1:1 session',
        icon: <CalendarPlus className="h-4 w-4" strokeWidth={1.75} />,
        onClick: () => setOpen(true),
      }}
    >
      {children}
      <AssignPackageButton
        clientId={assign.clientId}
        packages={assign.packages}
        classes={assign.classes}
        availability={assign.availability}
        dogs={assign.dogs}
        members={assign.members}
        currentMembershipId={assign.currentMembershipId}
        open={open}
        onOpenChange={setOpen}
      />
    </EditScreen>
  )
}

/**
 * Invoices, with "New invoice" pinned to the foot.
 *
 * It opens the app's ONE sale composer (`SaleComposer` — the same one behind
 * the global "+" and a session's "Take payment"), pre-targeted at this client
 * so the trainer skips its "who is this for?" step. No second invoice builder.
 */
export function ClientInvoicesScreen({
  client,
  currency,
  canEdit,
  children,
}: {
  client: { id: string; name: string | null; dogName: string | null; dogPhotoUrl: string | null }
  currency: string
  canEdit: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)

  if (!canEdit) return <>{children}</>

  return (
    <EditScreen
      primary={{
        label: 'New invoice',
        icon: <Receipt className="h-4 w-4" strokeWidth={1.75} />,
        onClick: () => setOpen(true),
      }}
    >
      {children}
      <SaleComposer
        open={open}
        onClose={() => setOpen(false)}
        currency={currency}
        prefill={{ client }}
      />
    </EditScreen>
  )
}
