'use client'

import { useRouter } from 'next/navigation'
import { PackageForm, type PkgRow, type SessionFormOption } from '../package-form'

/**
 * Page-mode wrapper around the shared PackageForm for creating a new package.
 * Mirrors EditPackageForm. If the trainer just priced a package and hasn't
 * connected Stripe yet (and Connect is available), we bounce to the packages
 * list with a ?connect flag so the list shows the new package and pops the
 * connect-Stripe modal over it. Otherwise it just returns to /packages.
 */
export function NewPackageForm({
  sessionForms,
  promptConnect,
}: {
  sessionForms: SessionFormOption[]
  promptConnect: boolean
}) {
  const router = useRouter()

  function handleSaved(saved: PkgRow) {
    // Only nudge Stripe when the new package actually has a price to collect.
    if (promptConnect && saved.priceCents != null) {
      router.push(`/packages?connect=${encodeURIComponent(saved.name)}`)
      return
    }
    router.push('/packages')
    router.refresh()
  }

  return (
    <PackageForm
      existing={null}
      sessionForms={sessionForms}
      onCancel={() => router.push('/packages')}
      onSaved={handleSaved}
    />
  )
}
