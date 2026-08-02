import type { Metadata } from 'next'
import { auth } from '@/lib/auth'
import { DEFAULT_BRAND_COLOR } from '@/lib/brand'
import { resolveContinuation } from '@/lib/form-continuation'
import { PublicFormShell, PUBLIC_FORM_CARD } from '@/components/shared/public-form-shell'
import { ContinuationAccountStep } from './account-step'

export const metadata: Metadata = { title: 'Set up your login' }
// The token is in the query string and the answer differs per token — there is
// nothing here to cache or prerender.
export const dynamic = 'force-dynamic'

/**
 * Step two of the continuous run: a password, and nothing else.
 *
 * They have already given their name, their email and their answers on the
 * previous screen, so this asks for the ONE thing that is missing. The email is
 * shown, not editable — it comes off the enquiry row the token resolves to,
 * which is the whole reason this endpoint cannot be used to probe for other
 * people's accounts (see lib/form-continuation).
 *
 * Every failure here lands somewhere, never on a blank page: an expired link, a
 * spent link and a stranger's link each say what happened and what to do. The
 * trainer already holds the enquiry either way, so nobody is ever stuck with
 * "we have your details and there is no way to reach anyone".
 */
export default async function ContinuationAccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ formId: string }>
  searchParams: Promise<{ t?: string }>
}) {
  const { formId } = await params
  const { t } = await searchParams

  const resolved = await resolveContinuation(formId, t ?? '')

  // A session already on this browser changes what any of the screens below
  // say — most obviously the one for a spent link, which is what somebody who
  // finished the run and then hit Back is looking at.
  const session = await auth()
  const sessionEmail = session?.user?.email?.trim().toLowerCase() ?? null

  if (!resolved.ok) {
    // Someone signed in on a spent link has almost certainly just finished the
    // run and pressed Back. Telling them to fill the form in a second time
    // would be the daftest possible answer.
    if (sessionEmail) {
      return (
        <PublicFormShell
          businessName="PupManager"
          trainerLogoUrl={null}
          heading="You're all set"
          reviewScope="Continuous sign-up: already finished"
        >
          <div className={PUBLIC_FORM_CARD}>
            <p className="text-sm leading-relaxed text-slate-500">
              This sign-up is already done and you&apos;re signed in as{' '}
              <span className="font-medium text-slate-900">{sessionEmail}</span>.
            </p>
            <a
              href="/home"
              className="flex h-12 items-center justify-center rounded-xl bg-[var(--accent,#2563eb)] text-sm font-semibold text-white"
            >
              Go to my diary
            </a>
          </div>
        </PublicFormShell>
      )
    }

    const copy =
      resolved.problem === 'EXPIRED'
        ? {
            heading: 'This link has expired',
            body: 'Links last 24 hours. Your details did reach your trainer — they can still get back to you, or you can fill the form in again for a fresh link.',
          }
        : {
            // NOT_FOUND and USED read the same on purpose. A finished run drops
            // its own digest (so the row keeps nothing usable), which means a
            // link that has been SPENT and a link that never existed both land
            // here — and the honest answer covers both without guessing.
            heading: 'This link is no longer active',
            body: 'It may already have been used, or it may have been copied incompletely. If you finished setting up, just sign in. If not, fill the form in again for a fresh link.',
          }

    return (
      <PublicFormShell
        businessName="PupManager"
        trainerLogoUrl={null}
        heading={copy.heading}
        reviewScope={`Continuous sign-up: link problem (${resolved.problem})`}
      >
        <div className={PUBLIC_FORM_CARD}>
          <p className="text-sm leading-relaxed text-slate-500">{copy.body}</p>
          <a
            href="/login"
            className="flex h-12 items-center justify-center rounded-xl bg-[var(--accent,#2563eb)] text-sm font-semibold text-white"
          >
            Go to sign in
          </a>
        </div>
      </PublicFormShell>
    )
  }

  const run = resolved.run
  const brand = run.trainer.emailAccentColor || DEFAULT_BRAND_COLOR

  // Three screens when the trainer nominated an intake form, two when they
  // didn't. Saying so up front is the difference between "one more thing" and
  // "how much longer is this".
  const totalSteps = run.intakeFormId ? 3 : 2

  return (
    <div style={{ ['--accent' as string]: brand } as React.CSSProperties}>
      <PublicFormShell
        businessName={run.trainer.businessName}
        trainerLogoUrl={run.trainer.logoUrl}
        heading="Set up your login"
        progress={{ index: 1, total: totalSteps, label: `Step 2 of ${totalSteps} · Your login` }}
        reviewScope={`Continuous sign-up: Step 2 of ${totalSteps} · Your login`}
      >
        <ContinuationAccountStep
          formId={formId}
          token={t ?? ''}
          email={run.email}
          businessName={run.trainer.businessName}
          // A session already on this browser changes what is asked for: their
          // own session means no password step at all, and somebody else's
          // means the run must stop rather than attach to the wrong account.
          signedInAs={sessionEmail}
        />
      </PublicFormShell>
    </div>
  )
}
