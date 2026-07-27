'use client'

import { useRouter } from 'next/navigation'
import { PackageForm, type PkgRow, type SessionFormOption } from '../../packages/package-form'

/** Where a newly-created offering belongs — the list it will now appear on.
 *  Reads the kind the offering was SAVED as (the server echoes the row back),
 *  so a class that happens to run once lands on /classes like every other. */
function listFor(saved: PkgRow): string {
  if (!saved.isGroup) return '/packages'
  if (saved.allowDropIn) return '/casual-classes'
  if (saved.isEvent) return '/events'
  return '/classes'
}

/**
 * Page-mode wrapper around the shared PackageForm for creating a new package.
 * Mirrors EditPackageForm. If the trainer just priced a package and hasn't
 * connected Stripe yet (and Connect is available), we bounce with a ?connect
 * flag so the list pops the connect-Stripe modal over it.
 *
 * The landing page is the list the thing now lives on — a new class goes to
 * /classes, an event to /events — because a group offering saved with a start
 * date is scheduled, not just defined, and dumping the trainer back on
 * /packages made it look like nothing had happened.
 */
export function NewPackageForm({
  sessionForms,
  region,
  initialKind,
  promptConnect,
}: {
  sessionForms: SessionFormOption[]
  region?: string
  initialKind?: 'onetoone' | 'group' | 'dropin' | 'oneoff'
  promptConnect: boolean
}) {
  const router = useRouter()

  function handleSaved(saved: PkgRow) {
    const list = listFor(saved)
    // Only nudge Stripe when the new offering actually has a price to collect.
    if (promptConnect && saved.priceCents != null) {
      router.push(`${list}?connect=${encodeURIComponent(saved.name)}`)
      return
    }
    router.push(list)
    router.refresh()
  }

  return (
    <PackageForm
      existing={null}
      sessionForms={sessionForms}
      region={region}
      initialKind={initialKind}
      onCancel={() => router.push('/packages')}
      onSaved={handleSaved}
    />
  )
}
