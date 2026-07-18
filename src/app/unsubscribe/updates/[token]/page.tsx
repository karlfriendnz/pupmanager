import { prisma } from '@/lib/prisma'
import { verifyProductUnsubscribeToken } from '@/lib/unsubscribe-token'
import { ResubscribeButton } from './resubscribe-button'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Unsubscribe', robots: { index: false } }

// Public, no-auth page reached from the Unsubscribe link in a PupManager
// product-update email. The HMAC token identifies the user and proves the link
// is genuine. Loading the page opts the user out of product emails (idempotent);
// the in-app notification bell is never affected. A resubscribe undoes a
// mistaken click.
export default async function ProductUnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const userId = verifyProductUnsubscribeToken(token)

  let ok = false
  if (userId) {
    const res = await prisma.user.updateMany({
      where: { id: userId },
      data: { productEmailOptOut: true },
    })
    ok = res.count > 0
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-sm border border-slate-200 p-8 text-center">
        {ok ? (
          <>
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-teal-50 text-2xl">✅</div>
            <h1 className="text-lg font-semibold text-slate-900">You&rsquo;re unsubscribed from product updates</h1>
            <p className="mt-2 text-sm text-slate-500">
              You won&rsquo;t get any more &ldquo;what&rsquo;s new&rdquo; emails from PupManager. You&rsquo;ll still see
              updates in the app, and you&rsquo;ll still get important emails about your account.
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
              This unsubscribe link is invalid or has expired. If you keep getting unwanted emails, reply to one and ask
              to be removed.
            </p>
          </>
        )}
      </div>
    </main>
  )
}
