import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { validateSlug } from '@/lib/slug'

const patchSchema = z.object({
  businessName: z.string().min(2).optional(),
  // Public client-login slug. Normalised + uniqueness-checked below.
  slug: z.string().max(60).optional(),
  phone: z.string().optional(),
  showPhoneToClients: z.boolean().optional(),
  // Feature toggles (onboarding + Settings): run classes, record notes, offer a
  // client-facing app.
  clientAppEnabled: z.boolean().optional(),
  classesEnabled: z.boolean().optional(),
  notesEnabled: z.boolean().optional(),
  // When on, a receivable raised on a priced assignment is emailed to the client
  // immediately; off = created for the trainer to review + send from Finances.
  autoSendInvoices: z.boolean().optional(),
  // Default for the per-item "require payment to book" control. On = a priced
  // item + payments enabled means the client pays up front; off = book now, pay
  // later by default (each item can still override).
  defaultRequirePayment: z.boolean().optional(),
  // Client self-cancellation fee, in the trainer's payout-currency minor units.
  // null (or 0) = no fee. Window = only charge cancellations within N hours of
  // the start; null window = charge ANY cancellation when a fee is set.
  cancellationFeeCents: z.number().int().min(0).max(100_000_00).nullable().optional(),
  cancellationFeeWindowHours: z.number().int().min(1).max(8760).nullable().optional(),
  // Onboarding personas that describe what the business offers. Drives which
  // schedule "add" options appear. Loose string ids (validated against the
  // known persona list would couple this route to the wizard) — unknown ids are
  // simply ignored by the mapping in service-offerings.ts.
  businessRoles: z.array(z.string().min(1).max(30)).max(10).optional(),
  // Team emails to invite later (captured in onboarding, sent from dashboard).
  pendingTeamInvites: z.array(z.string().email()).max(50).optional(),
  // ISO 3166-1 alpha-2 country (e.g. "NZ"), or empty string to clear. Normally
  // auto-set from the IP at signup, but settable here when that wasn't captured.
  signupCountry: z.string().regex(/^[A-Za-z]{2}$/).optional().or(z.literal('')),
  logoUrl: z.string().url().optional().or(z.literal('')),
  iconUrl: z.string().url().optional().or(z.literal('')),
  website: z.string().max(200).optional().or(z.literal('')),
  publicEmail: z.string().max(200).optional().or(z.literal('')),
  inviteTemplate: z.string().optional(),
  // Brand colour — 3- or 6-digit hex (with leading #), or empty string to clear.
  // Drives the client-app accent AND the accent strip on outbound emails.
  emailAccentColor: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/).optional().or(z.literal('')),
  // Personal welcome note shown to clients on the app home (empty to clear).
  clientWelcomeNote: z.string().max(500).optional().or(z.literal('')),
  // Schedule view prefs. Hours 0–23, days 1=Mon..7=Sun, end > start.
  // The mobile pair is an optional override applied only on phones —
  // pass `null` to clear and fall back to the desktop pair.
  scheduleStartHour: z.number().int().min(0).max(23).optional(),
  scheduleEndHour: z.number().int().min(1).max(24).optional(),
  scheduleMobileStartHour: z.number().int().min(0).max(23).nullable().optional(),
  scheduleMobileEndHour: z.number().int().min(1).max(24).nullable().optional(),
  scheduleDays: z.array(z.number().int().min(1).max(7)).min(1).max(7).optional(),
  // Built-in session/client field ids OR "custom:<cuid>". Mirrors the
  // /clients column selector so trainers can pick the same fields here.
  scheduleExtraFields: z.array(z.string().regex(/^(location|description|sessionType|duration|title|email|extraDogs|compliance|custom:[a-z0-9]+)$/)).max(2).optional(),
  // Built-in column ids OR "custom:<cuid>" for trainer-defined custom fields.
  clientListColumns: z.array(z.string().regex(/^(email|dog|breed|extraDogs|nextSession|compliance|shared|custom:[a-z0-9]+)$/)).optional(),
  // null = flat list. "nextDay" = group by day of next booking.
  // "custom:<cuid>" = group by custom-field value.
  clientListGroupBy: z.string().regex(/^(nextDay|custom:[a-z0-9]+)$/).nullable().optional(),
  // Ordered list of intake-form sections. Each entry has a required name and
  // an optional description (shown to the client at the top of the section).
  intakeSectionOrder: z.array(z.object({
    name: z.string().min(1).max(60),
    description: z.string().max(500).nullable().optional(),
  })).max(50).optional(),
  // Master publish flag for the intake form. False = draft, hidden from clients.
  intakeFormPublished: z.boolean().optional(),
  // Section assignment for the three "system" fields on the intake form
  // (name, email, phone). Each value is the name of a section in
  // intakeSectionOrder, or null for orphan. The keys are open to allow
  // any of the three to be sent independently — sending one key doesn't
  // wipe the others (we merge with the existing JSON below).
  intakeSystemFieldSections: z.object({
    name: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
  }).optional(),
  // Per-company required/quick-add flags for the built-in client/dog fields
  // (see src/lib/client-fields.ts). The config UI sends the whole object.
  clientFieldConfig: z.record(
    z.string(),
    z.object({ required: z.boolean().optional(), quickAdd: z.boolean().optional() }),
  ).optional(),
})

export async function GET() {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const profile = await prisma.trainerProfile.findUnique({
    where: { id: session.user.trainerId ?? '' },
  })

  return NextResponse.json(profile)
}

export async function PATCH(req: Request) {
  const guard = await guardPermission('settings.edit')
  if (guard instanceof NextResponse) return guard
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const body = await req.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  }

  const data = { ...parsed.data }
  // Empty string from the colour input means "clear this" — store as null
  // so the email template falls back to the default.
  if (data.emailAccentColor === '') data.emailAccentColor = null as unknown as string
  if (data.clientWelcomeNote === '') data.clientWelcomeNote = null as unknown as string
  if (data.website === '') data.website = null as unknown as string
  if (data.publicEmail === '') data.publicEmail = null as unknown as string
  if (data.signupCountry === '') data.signupCountry = null as unknown as string
  else if (data.signupCountry) data.signupCountry = data.signupCountry.toUpperCase()

  // Normalise + uniqueness-check the public client-login slug.
  if (data.slug !== undefined) {
    const result = validateSlug(data.slug)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }
    const clash = await prisma.trainerProfile.findUnique({
      where: { slug: result.slug },
      select: { id: true },
    })
    if (clash && clash.id !== guard.companyId) {
      return NextResponse.json({ error: 'That link is already taken — try another.' }, { status: 409 })
    }
    data.slug = result.slug
  }

  // Merge intakeSystemFieldSections instead of replacing — the editor
  // sends one key at a time when the trainer drags a single system
  // field. A wholesale write would clobber the other assignments.
  if (data.intakeSystemFieldSections) {
    const current = await prisma.trainerProfile.findUnique({
      where: { id: guard.companyId },
      select: { intakeSystemFieldSections: true },
    })
    const existing = (current?.intakeSystemFieldSections as Record<string, string | null> | null) ?? {}
    data.intakeSystemFieldSections = { ...existing, ...data.intakeSystemFieldSections }
  }

  const profile = await prisma.trainerProfile.update({
    where: { id: guard.companyId },
    data,
  })

  return NextResponse.json(profile)
}
