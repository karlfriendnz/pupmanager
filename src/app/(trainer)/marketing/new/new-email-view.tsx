'use client'

import { useRouter } from 'next/navigation'
import {
  EmailComposer,
  type EmailCandidate,
  type RecipientFacets,
  type ComposerBrand,
} from '../../clients/email-composer'

// Client wrapper for the full-page composer: routes back to /marketing on
// cancel and after a successful send (passing the summary along as a flash).
export function NewEmailView({
  candidates,
  facets,
  brand,
}: {
  candidates: EmailCandidate[]
  facets: RecipientFacets
  brand: ComposerBrand
}) {
  const router = useRouter()
  return (
    <EmailComposer
      mode="page"
      candidates={candidates}
      facets={facets}
      brand={brand}
      onSent={(summary) => {
        router.push(`/marketing?sent=${encodeURIComponent(summary)}`)
      }}
      onCancel={() => router.push('/marketing')}
    />
  )
}
