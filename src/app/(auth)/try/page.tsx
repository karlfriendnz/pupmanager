import type { Metadata } from 'next'
import { TryFlow } from './try-flow'
import { TRY_TERMS_V2 } from '@/lib/demo-consent'
import { PERSONAS } from '@/lib/onboarding-recommendations'
import { normaliseCampaign, normaliseSource } from '@/lib/demo-lead'

export const metadata: Metadata = {
  title: 'Try PupManager',
  description: 'Have a play with PupManager on your own phone.',
  // A demo sandbox is not a page we want indexed or shared into search results.
  robots: { index: false, follow: false },
}

/**
 * The trade-show "Try It" entry point.
 *
 * Reached by scanning a QR code on a poster (`/try?src=qr&ev=<show>`) or by
 * following a plain link — the two are the same page, because Karl wants to be
 * able to send this to someone who is not standing at the stand.
 *
 * The consent WORDING is resolved on the server and passed down, so the words
 * on screen and the version id recorded against the lead cannot drift apart:
 * there is exactly one source for both, and the API refuses a submission
 * carrying any other id.
 *
 * The persona list is `PERSONAS` — the same catalog the onboarding wizard and
 * `TrainerProfile.businessRoles` use. Not a parallel list; a groomer picking
 * "Groomer" here gets the groomer seed data because it is literally the same
 * id flowing into the same seeder.
 */
export default async function TryPage({
  searchParams,
}: {
  searchParams: Promise<{ src?: string; ev?: string }>
}) {
  const params = await searchParams
  return (
    <TryFlow
      terms={TRY_TERMS_V2}
      personas={PERSONAS}
      source={normaliseSource(params.src)}
      campaign={normaliseCampaign(params.ev) ?? ''}
    />
  )
}
