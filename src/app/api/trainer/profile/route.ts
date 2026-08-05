import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { auth } from '@/lib/auth'
import { sanitizeRichHtml, isRichTextEmpty } from '@/lib/rich-text'
import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { validateSlug } from '@/lib/slug'
import { cssImageUrlSchema } from '@/lib/asset-url'
import { applyFieldPacksForRoles } from '@/lib/onboarding/apply-field-packs'
import { seedScheduleDefaultsForRoles } from '@/lib/onboarding/schedule-defaults'

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
  // Base currency for all prices/invoices shown AND charged (drives display
  // app-wide, not just Stripe payouts). Lower-case ISO from the supported set.
  // Always editable — Stripe charges in this presentment currency and settles
  // to the connected account (with FX where they differ).
  payoutCurrency: z.enum(['aud', 'nzd', 'gbp', 'cad', 'usd', 'zar']).optional(),
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
  // Background photo behind the top of the trainer home, and whether the logo
  // lockup sits over it. Both are COMPANY-wide by construction — this route
  // only ever writes TrainerProfile[guard.companyId], and that row is the
  // business, so every staff member of one business shares one home screen.
  // The URL is validated harder than the others because it is rendered inside
  // a CSS url() rather than an <img src> — see cssImageUrlSchema.
  homeHeroImageUrl: cssImageUrlSchema().optional(),
  homeHeroShowLockup: z.boolean().optional(),
  iconUrl: z.string().url().optional().or(z.literal('')),
  website: z.string().max(200).optional().or(z.literal('')),
  // The CLIENT-FACING contact address, so it has to be a real one: it becomes a
  // mailto: on the client Help page, the reply-to on enquiry auto-replies, and
  // the address on the public link page. Both signup routes have always checked
  // it; this one — the screen a trainer actually edits it on — only capped the
  // length, so anything typed past the browser's own type=email check (a script,
  // a stale tab, an import) was stored and quietly broke every one of those.
  publicEmail: z.union([z.string().email('Enter a valid email').max(200), z.literal('')]).optional(),
  inviteTemplate: z.string().optional(),
  // Brand colour — 3- or 6-digit hex (with leading #), or empty string to clear.
  // Drives the client-app accent AND the accent strip on outbound emails.
  emailAccentColor: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/).optional().or(z.literal('')),
  // Personal welcome note shown to clients on the app home (empty to clear).
  // Rich text (Tiptap HTML) since Settings → Design edits it with RichTextEditor,
  // so the cap is on the MARKUP, not the words — a few paragraphs of formatted
  // text runs well past the old 500. Sanitized below; plain text is accepted too
  // (the first-run wizard still posts plain text, and every legacy value is).
  clientWelcomeNote: z.string().max(4000).optional().or(z.literal('')),
  // Schedule view prefs. Hours 0–23, days 1=Mon..7=Sun, end > start.
  // The mobile pair is an optional override applied only on phones —
  // pass `null` to clear and fall back to the desktop pair.
  scheduleStartHour: z.number().int().min(0).max(23).optional(),
  scheduleEndHour: z.number().int().min(1).max(24).optional(),
  scheduleMobileStartHour: z.number().int().min(0).max(23).nullable().optional(),
  scheduleMobileEndHour: z.number().int().min(1).max(24).nullable().optional(),
  scheduleDays: z.array(z.number().int().min(1).max(7)).min(1).max(7).optional(),
  // Last-chosen grid layout, kept per device class for the same reason the
  // hours are: a phone wants a day column where a desktop wants the week.
  // 'agenda' is the one-day LIST (what 'day' used to mean); 'day' is now the
  // hour-by-hour grid for a single day. scripts/backfill-schedule-agenda-view.ts
  // moves stored 'day' preferences over so nobody's saved layout changes meaning.
  scheduleView: z.enum(['agenda', 'day', 'threeDay', 'week']).nullable().optional(),
  scheduleMobileView: z.enum(['agenda', 'day', 'threeDay', 'week']).nullable().optional(),
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
  // The welcome note is trainer-authored and rendered to every one of their
  // clients, so this route — not the browser — is the XSS boundary. Sanitize with
  // the shared rich-text allowlist (NOT the admin-only regex sanitizeEmailHtml),
  // and store null for an empty document (''/'<p></p>'/whitespace) so the client
  // home drops the Welcome block instead of rendering an empty card.
  if (data.clientWelcomeNote !== undefined) {
    data.clientWelcomeNote = (
      isRichTextEmpty(data.clientWelcomeNote) ? null : sanitizeRichHtml(data.clientWelcomeNote)
    ) as unknown as string
  }
  if (data.website === '') data.website = null as unknown as string
  // "Remove image" posts an empty string; store null so the home screen falls
  // back to no photo rather than an empty background-image declaration.
  if (data.homeHeroImageUrl === '') data.homeHeroImageUrl = null as unknown as string
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

  // What their trade WAS, read before the update lands — the difference is what
  // decides whether there are starter fields to seed at all. See below.
  const rolesBefore = parsed.data.businessRoles
    ? ((await prisma.trainerProfile.findUnique({
        where: { id: guard.companyId },
        select: { businessRoles: true },
      }))?.businessRoles ?? [])
    : []

  const profile = await prisma.trainerProfile.update({
    where: { id: guard.companyId },
    data,
  })

  // The client home is a server component, so a trainer saving here changes
  // nothing a client has already been served — the welcome note, business name,
  // logo and brand colour all render from a cached page. Same class of bug as
  // the dog photo that saved and kept showing the placeholder (2026-08-06).
  //
  // Swallowed deliberately: the profile row is ALREADY written by this point, so
  // a throw from revalidation would report a failed save for something that
  // saved — the trainer retypes a welcome note that was never lost. A stale
  // screen is the smaller problem and clears itself.
  try {
    revalidatePath('/home')
  } catch (err) {
    console.error('Client-home revalidation failed (profile itself saved):', err)
  }

  // When they tell us their trade, pre-create the matching starter fields so
  // their intake form isn't blank (a groomer gets coat type / last groomed,
  // etc.). Best-effort: never fail the profile save over it.
  //
  // Only for roles they've just ADDED. applyFieldPacksForRoles dedups on the
  // labels that currently exist, which is not the same as remembering what it
  // once created: delete a starter field you don't want, save anything on this
  // screen afterwards (this form posts businessRoles every time, unchanged),
  // and the field was created again because its label was no longer taken.
  // Deleted fields kept coming back, and the trainer had no way to make them
  // stay gone. Nothing new is seeded when the trade hasn't changed.
  const addedRoles = (parsed.data.businessRoles ?? []).filter(r => !rolesBefore.includes(r))
  if (addedRoles.length) {
    await Promise.all([
      applyFieldPacksForRoles(prisma, guard.companyId, addedRoles),
      // Sensible starting hours for their trade (a groomer breaks for lunch).
      // Only seeds when they have no availability yet, so it never overwrites
      // hours they've set.
      seedScheduleDefaultsForRoles(prisma, guard.companyId, addedRoles),
    ]).catch(() => {})
  }

  return NextResponse.json(profile)
}
