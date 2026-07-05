import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { enforceRateLimit, getClientIp } from '@/lib/rate-limit'
import { fetchBookingSlots, isSlotAvailable } from '@/lib/booking-slots'
import { bookingConfig, materializeBooking } from '@/lib/booking-page'
import { createInvoiceForAssignment } from '@/lib/invoicing'
import { generateSessionDates } from '@/lib/self-book'
import { safeEvaluate } from '@/lib/achievements'
import { notifyEnquiryTrainer } from '@/lib/notify-enquiry-trainer'
import { runOnBookingAutomations } from '@/lib/booking-automations'
import { createConnectCheckout } from '@/lib/connect-checkout'
import { isConnectConfigured } from '@/lib/connect'
import { env } from '@/lib/env'

// Public booking endpoint for a single booking page: /c/<slug>/book/<pageSlug>.
//   GET  — current bookable slots (for the picker to refresh).
//   POST — book a chosen slot. An existing client of this trainer books
//          themselves (instant or BookingRequest per the page's
//          requiresApproval); anyone else submits a prospect Enquiry the
//          trainer accepts to both convert them to a client and book it.

async function loadEnabledPage(slug: string, pageSlug: string) {
  const trainer = await prisma.trainerProfile.findUnique({
    where: { slug },
    select: {
      id: true,
      businessName: true,
      user: { select: { timezone: true } },
      // Connect/payment state for pay-to-confirm pages.
      acceptPaymentsEnabled: true,
      connectChargesEnabled: true,
      connectAccountId: true,
      payoutCurrency: true,
      sandboxBilling: true,
      bookingPages: { where: { slug: pageSlug } },
    },
  })
  const page = trainer?.bookingPages[0]
  if (!trainer || !page?.enabled) return null
  return { trainer, page }
}

async function loadPackage(trainerId: string, packageId: string | null) {
  if (!packageId) return null
  return prisma.package.findFirst({
    where: { id: packageId, trainerId },
    select: { id: true, name: true, sessionCount: true, weeksBetween: true, durationMins: true, sessionType: true, priceCents: true, specialPriceCents: true },
  })
}

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; pageSlug: string }> }) {
  const { slug, pageSlug } = await params
  const ctx = await loadEnabledPage(slug, pageSlug)
  if (!ctx) return NextResponse.json({ error: 'Booking not available' }, { status: 404 })

  const days = await fetchBookingSlots(ctx.trainer.id, bookingConfig(ctx.page, ctx.trainer.user.timezone))
  return NextResponse.json({ days })
}

const schema = z.object({
  slotIso: z.string().min(1),
  name: z.string().min(1).max(120).optional(),
  email: z.string().email().max(200).optional(),
  phone: z.string().max(40).optional().nullable(),
  dogName: z.string().max(120).optional().nullable(),
  message: z.string().max(4000).optional().nullable(),
})

export async function POST(req: Request, { params }: { params: Promise<{ slug: string; pageSlug: string }> }) {
  const limited = await enforceRateLimit({ key: `book:${getClientIp(req)}`, limit: 12, windowMs: 10 * 60_000 })
  if (limited) return limited

  const { slug, pageSlug } = await params
  const ctx = await loadEnabledPage(slug, pageSlug)
  if (!ctx) return NextResponse.json({ error: 'Booking not available' }, { status: 404 })
  const { trainer, page } = ctx
  const tz = trainer.user.timezone

  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const slotAt = new Date(parsed.data.slotIso)
  if (Number.isNaN(slotAt.getTime())) return NextResponse.json({ error: 'Invalid slot' }, { status: 400 })

  const cfg = bookingConfig(page, tz)
  if (!(await isSlotAvailable(trainer.id, cfg, slotAt.toISOString()))) {
    return NextResponse.json({ error: 'That time was just taken — pick another.', code: 'SLOT_TAKEN' }, { status: 409 })
  }

  const pkg = await loadPackage(trainer.id, page.packageId)

  const session = await auth()
  const client = session?.user?.id
    ? await prisma.clientProfile.findFirst({
        where: { userId: session.user.id, trainerId: trainer.id },
        select: { id: true, dogId: true, user: { select: { name: true, email: true } }, dog: { select: { name: true } } },
      })
    : null

  // ON_BOOKING automations fire to the booker's email the moment they book.
  const fireOnBooking = (email: string | null, name: string, dogName: string | null) => {
    if (!email) return
    void runOnBookingAutomations({
      bookingPageId: page.id,
      recipientEmail: email,
      name,
      dogName,
      sessionAt: slotAt,
      tz,
      businessName: trainer.businessName,
    })
  }

  if (client) {
    const singleTitle = page.headline?.trim() || page.name || `${trainer.businessName} session`

    // ── Pay-to-confirm: charge first, the webhook books on success. Payment
    // supersedes approval. Falls through to the free flow if no price/payments. ──
    if (page.requiresPayment) {
      const price = pkg ? (pkg.specialPriceCents ?? pkg.priceCents) : page.priceCents
      if (price && price > 0 && trainer.acceptPaymentsEnabled && trainer.connectChargesEnabled && trainer.connectAccountId) {
        const sandbox = trainer.sandboxBilling
        if (!isConnectConfigured(sandbox)) {
          return NextResponse.json({ error: 'Payments are not configured yet' }, { status: 503 })
        }
        const base = `${env.NEXT_PUBLIC_APP_URL}/c/${slug}/book/${pageSlug}`
        const { url } = await createConnectCheckout({
          sandbox,
          trainerId: trainer.id,
          connectAccountId: trainer.connectAccountId,
          clientId: client.id,
          currency: trainer.payoutCurrency ?? 'nzd',
          description: pkg?.name ?? singleTitle,
          lines: [
            {
              kind: pkg ? 'PACKAGE' : 'SESSION',
              description: pkg?.name ?? singleTitle,
              unitAmount: price,
              quantity: 1,
              intent: {
                packageId: pkg?.id ?? null,
                slotIso: slotAt.toISOString(),
                dogId: client.dogId,
                bookingPageId: page.id,
                singleDurationMins: page.slotLengthMins,
                singleSessionType: page.sessionType,
                singleTitle,
              },
            },
          ],
          successUrl: `${base}?purchase=success`,
          cancelUrl: `${base}?purchase=cancelled`,
        })
        if (!url) return NextResponse.json({ error: 'Could not start checkout' }, { status: 502 })
        return NextResponse.json({ ok: true, mode: 'payment', url }, { status: 201 })
      }
      // No resolvable price or payments off — fall through to the free flow.
    }

    // ── Existing client: honour instant-vs-approval (packages only). ──
    if (pkg && page.requiresApproval) {
      await prisma.bookingRequest.create({
        data: {
          trainerId: trainer.id,
          clientId: client.id,
          packageId: pkg.id,
          dogId: client.dogId,
          bookingPageId: page.id,
          sessionDates: generateSessionDates(slotAt, pkg.sessionCount, pkg.weeksBetween).map(d => d.toISOString()),
        },
      })
      fireOnBooking(client.user?.email ?? null, client.user?.name ?? 'there', client.dog?.name ?? null)
      return NextResponse.json({ ok: true, mode: 'requested' }, { status: 201 })
    }

    const clientPackageId = await prisma.$transaction(tx =>
      materializeBooking(tx, {
        trainerId: trainer.id,
        clientId: client.id,
        dogId: client.dogId,
        slotAt,
        pkg: pkg ? { ...pkg } : null,
        singleDurationMins: page.slotLengthMins,
        singleSessionType: page.sessionType,
        singleTitle,
        bookingPageId: page.id,
      }),
    )
    await safeEvaluate(client.id)
    // Best-effort receivable when this booking kicked off a priced package
    // (single one-off sessions return no clientPackageId and aren't invoiced here).
    if (clientPackageId) {
      await createInvoiceForAssignment({ trainerId: trainer.id, clientId: client.id, sourceType: 'PACKAGE', clientPackageId })
    }
    fireOnBooking(client.user?.email ?? null, client.user?.name ?? 'there', client.dog?.name ?? null)
    return NextResponse.json({ ok: true, mode: 'booked' }, { status: 201 })
  }

  // ── Prospect: needs contact details; lands as an Enquiry to convert. ──
  if (!parsed.data.name?.trim() || !parsed.data.email?.trim()) {
    return NextResponse.json({ error: 'Name and email are required.', code: 'DETAILS_REQUIRED' }, { status: 400 })
  }

  const existingUser = await prisma.user.findUnique({ where: { email: parsed.data.email.trim() }, select: { id: true } })
  if (existingUser) {
    return NextResponse.json(
      { error: 'An account already exists for that email — please log in first, then book.', code: 'ACCOUNT_EXISTS' },
      { status: 409 },
    )
  }

  const enquiry = await prisma.enquiry.create({
    data: {
      trainerId: trainer.id,
      name: parsed.data.name.trim(),
      email: parsed.data.email.trim(),
      phone: parsed.data.phone?.trim() || null,
      dogName: parsed.data.dogName?.trim() || null,
      message: parsed.data.message?.trim() || null,
      bookedSlotAt: slotAt,
      bookedPackageId: pkg?.id ?? null,
      bookedPageId: page.id,
    },
    select: { id: true },
  })
  await notifyEnquiryTrainer({ enquiryId: enquiry.id })
  fireOnBooking(parsed.data.email.trim(), parsed.data.name.trim(), parsed.data.dogName?.trim() || null)

  return NextResponse.json({ ok: true, mode: 'enquiry' }, { status: 201 })
}
