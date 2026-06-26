'use client'

import { useRouter } from 'next/navigation'
import { PackageForm, type PkgRow, type SessionFormOption } from '../../package-form'

/**
 * Page-mode wrapper around the shared PackageForm. On save (or cancel) it
 * returns to the packages list and refreshes server state so the list,
 * trainer layout FAB and onboarding wizard pick up the change.
 */
export function EditPackageForm({
  existing,
  sessionForms,
}: {
  existing: PkgRow
  sessionForms: SessionFormOption[]
}) {
  const router = useRouter()

  function done() {
    router.push('/packages')
    router.refresh()
  }

  return (
    <PackageForm
      existing={existing}
      sessionForms={sessionForms}
      onCancel={() => router.push('/packages')}
      onSaved={done}
    />
  )
}
