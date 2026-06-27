import { prisma } from '@/lib/prisma'
import { verifySubscriberUnsubToken } from '@/lib/subscriber-unsubscribe-token'
import { ResubscribeSubscriberButton } from './resubscribe-button'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Unsubscribe', robots: { index: false } }

// Public, no-auth unsubscribe for mailing-list subscribers (lead-magnet
// sign-ups). The HMAC token both identifies the subscriber and proves the link
// is genuine. Loading the page opts them out (idempotent); a resubscribe action
// lets them undo a misclick.
export default async function SubscriberUnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const subscriberId = verifySubscriberUnsubToken(token)

  let businessName: string | null = null
  let ok = false
  if (subscriberId) {
    const sub = await prisma.subscriber.findUnique({
      where: { id: subscriberId },
      select: { id: true, trainer: { select: { businessName: true } } },
    })
    if (sub) {
      ok = true
      businessName = sub.trainer.businessName
      await prisma.subscriber.update({
        where: { id: sub.id },
        data: { status: 'UNSUBSCRIBED', unsubscribedAt: new Date() },
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
              You won&rsquo;t receive any more emails{businessName ? ` from ${businessName}` : ''}.
            </p>
            <div className="mt-6">
              <ResubscribeSubscriberButton token={token} />
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
