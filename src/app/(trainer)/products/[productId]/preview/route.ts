import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { PREVIEW_COOKIE } from '@/lib/client-context'

// /products/[productId]/preview — "show me this the way a client sees it".
//
// It reuses the CLIENT PREVIEW COOKIE rather than inventing a read-only
// trainer-flavoured shop, and that is the whole design decision, so:
//
// The shop resolves everything through getActiveClient() — the trainer's
// currency, the "you already asked for this" state, whether Buy or Request is
// even offered. A preview with no client behind it would have to fake all of
// that, which means a second rendering of the shop that can drift from the one
// clients actually get: the exact bug a preview exists to prevent. Borrowing a
// real client's view gives the true screen for free.
//
// The safety that comes with it is the other half. In preview the client layout
// hangs the amber banner, PreviewProvider flips useIsPreview(), and the sheet
// turns Buy off entirely and disables Request with PREVIEW_REASON. Behind that,
// /api/my/products/[id]/buy refuses outright while previewing, and both buy and
// request 404 on an inactive product — so the hidden product being previewed
// here cannot be ordered even by hand.
//
// A route handler, not a link straight to /my-shop, because the cookie has to be
// set before the client layout renders, and because ownership is re-checked here
// rather than trusted from whatever page drew the link.

const PREVIEW_TTL_SECONDS = 60 * 60

export async function GET(
  req: Request,
  ctx: { params: Promise<{ productId: string }> },
) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER' || !session.user.trainerId) {
    return NextResponse.redirect(new URL('/login', req.url))
  }
  const trainerId = session.user.trainerId
  const { productId } = await ctx.params

  // Scoped by trainerId, the same as the product page that links here: another
  // business's product is not "forbidden", it simply isn't found.
  const product = await prisma.product.findFirst({
    where: { id: productId, trainerId },
    select: { id: true },
  })
  if (!product) return NextResponse.redirect(new URL('/products', req.url))

  const store = await cookies()
  const current = store.get(PREVIEW_COOKIE)?.value
  // Already previewing somebody? Stay with them. Re-validated against this
  // trainer, so a stale or borrowed cookie can never pick the client.
  let clientId = current
    ? (await prisma.clientProfile.findFirst({
        where: { id: current, trainerId },
        select: { id: true },
      }))?.id ?? null
    : null

  if (!clientId) {
    clientId = (await prisma.clientProfile.findFirst({
      where: { trainerId, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    }))?.id ?? null
  }

  // No clients yet, so there is no client view of the shop to show. /preview-as
  // is the app's existing answer to that — it renders the synthetic demo and
  // explains itself — rather than a dead button or a blank screen.
  if (!clientId) return NextResponse.redirect(new URL('/preview-as', req.url))

  const response = NextResponse.redirect(
    new URL(`/my-shop?product=${encodeURIComponent(product.id)}`, req.url),
  )
  // Set on the RESPONSE: cookies() from next/headers doesn't ride along on a
  // redirect out of a route handler (same reason /preview-as/[clientId] does it
  // this way).
  response.cookies.set(PREVIEW_COOKIE, clientId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: PREVIEW_TTL_SECONDS,
  })
  return response
}
