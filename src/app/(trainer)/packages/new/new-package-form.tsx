'use client'

import { useRouter } from 'next/navigation'
import { PackageForm, type SessionFormOption } from '../package-form'

/**
 * Page-mode wrapper around the shared PackageForm for creating a new package.
 * Mirrors EditPackageForm: on save (or cancel) it returns to the packages
 * list and refreshes server state so the list, trainer layout FAB and
 * onboarding wizard pick up the new package.
 */
export function NewPackageForm({ sessionForms }: { sessionForms: SessionFormOption[] }) {
  const router = useRouter()

  function done() {
    router.push('/packages')
    router.refresh()
  }

  return (
    <PackageForm
      existing={null}
      sessionForms={sessionForms}
      onCancel={() => router.push('/packages')}
      onSaved={done}
    />
  )
}
