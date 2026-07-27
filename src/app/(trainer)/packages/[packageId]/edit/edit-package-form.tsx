'use client'

import { useRouter } from 'next/navigation'
import { PackageForm, type PkgRow, type SessionFormOption } from '../../package-form'

/** Where this offering came from, and so where Cancel and Save return to.
 *  A scheduled class goes back to the class itself — that's the page you were
 *  looking at when you hit Edit; anything else goes back to its list. */
export function offeringHome(pkg: PkgRow): string {
  if (pkg.classRunId) return `/classes/${pkg.classRunId}`
  if (!pkg.isGroup) return '/packages'
  if (pkg.allowDropIn) return '/casual-classes'
  if (pkg.isEvent) return '/events'
  return '/classes'
}

/**
 * Page-mode wrapper around the shared PackageForm. On save (or cancel) it
 * returns where you came from and refreshes server state so the list, trainer
 * layout FAB and onboarding wizard pick up the change.
 */
export function EditPackageForm({
  existing,
  sessionForms,
  region,
}: {
  existing: PkgRow
  sessionForms: SessionFormOption[]
  region?: string
}) {
  const router = useRouter()
  const home = offeringHome(existing)

  function done() {
    router.push(home)
    router.refresh()
  }

  return (
    <PackageForm
      existing={existing}
      sessionForms={sessionForms}
      region={region}
      onCancel={() => router.push(home)}
      onSaved={done}
    />
  )
}
