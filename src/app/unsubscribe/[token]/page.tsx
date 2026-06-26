import { prisma } from '@/lib/prisma'
import { verifyUnsubscribeToken } from '@/lib/unsubscribe-token'
import { ResubscribeButton } from './resubscribe-button'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Unsubscribe', robots: { index: false } }

// Public, no-auth page reached from the Unsubscribe link in a bulk email. The
// HMAC token both identifies the client relationship and proves the link is
// genuine. Loading the page opts the client out (idempotent); a resubscribe
// action lets them undo if they clicked by mistake.
export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const clientProfileId = verifyUnsubscribeToken(token)

  let businessName: string | null = null
  let ok = false
  if (clientProfileId) {
    const profile = await prisma.clientProfile.findUnique({
      where: { id: clientProfileId },
      select: { id: true, trainer: { select: { businessName: true } } },
    })
    if (profile) {
      ok = true
      businessName = profile.trainer.businessName
      await prisma.clientProfile.update({
        where: { id: profile.id },
        data: { marketingEmailOptOut: true, marketingOptOutAt: new Date(), marketingOptOutReason: 'UNSUBSCRIBED' },
      })
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-sm border border-slate-200 p-8 text-center">
        {ok ? (
          <>
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-teal-50 text-2xl">✅</div>
            <h1 className="text-lg font-semibold text-slate-900">You&rsquo;ve been unsubscribed</h1>
            <p className="mt-2 text-sm text-slate-500">
              You won&rsquo;t receive any more marketing emails{businessName ? ` from ${businessName}` : ''}. You&rsquo;ll
              still get essential messages about your sessions and account.
            </p>
            <div className="mt-6">
              <ResubscribeButton token={token} />
            </div>
          </>
        ) : (
          <>
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-2xl">🔗</div>
            <h1 className="text-lg font-semibold text-slate-900">Link not valid</h1>
            <p className="mt-2 text-sm text-slate-500">
              This unsubscribe link is invalid or has expired. If you keep receiving unwanted emails, reply to one and
              ask to be removed.
            </p>
          </>
        )}
      </div>
    </main>
  )
}
