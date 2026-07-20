import crypto from 'crypto'
import { prisma } from './prisma'
import { env } from './env'
import { sendEmail } from './email'
import { emailBodyToHtml } from './email-html'
import { materializeBooking } from './booking-page'
import { findOrJoinClient } from './client-upsert'
// escapeHtml lives in a client-safe module now; imported for internal use and
// re-exported so existing `from '@/lib/enquiries'` callers keep working.
import { escapeHtml } from './html-escape'
export { escapeHtml }

// Convert an enquiry into a real client. Mirrors what the form submit
// endpoint used to do inline:
//   1. Create User (role CLIENT)
//   2. Create Dog if dog details were captured
//   3. Create ClientProfile linking user → trainer → dog
//   4. Materialise the snapshotted customFieldValues into CustomFieldValue rows
//   4b. If the enquiry came from the public booking page (bookedSlotAt set),
//       place the booked session / package series onto the calendar
//   5. (Opt-in) Issue a NextAuth-compatible magic-link token + welcome email
//   6. Mark the enquiry ACCEPTED with a back-link to the ClientProfile
//
// `sendMagicLink` is opt-in — most trainers want to onboard manually first
// and send the diary invite later. Returns the ClientProfile id.
//
// Find-or-join: a returning person (an email that already belongs to a User)
// is REUSED, never duplicated. If they're already this trainer's client, the
// enquiry's dog is ADDED to their existing profile and the booked session lands
// on it — accepting never errors on "account already exists".
export async function acceptEnquiry(enquiryId: string, options: { appUrl: string; sendMagicLink: boolean }) {
  const enquiry = await prisma.enquiry.findUnique({
    where: { id: enquiryId },
    include: {
      trainer: { select: { id: true, businessName: true } },
      // Welcome-email copy is configured per originating form. May be null
      // if the form was deleted (formId SetNull) — we fall back to defaults.
      form: {
        select: {
          welcomeSubject: true,
          welcomeIntro: true,
          welcomeShowDiaryButton: true,
          welcomeButtonLabel: true,
        },
      },
    },
  })
  if (!enquiry) throw new EnquiryError('NOT_FOUND', 'Enquiry not found')
  if (enquiry.status !== 'NEW') throw new EnquiryError('INVALID_STATUS', `Enquiry is already ${enquiry.status.toLowerCase()}`)

  const customFieldSnapshot = (enquiry.customFieldValues ?? {}) as Record<string, string>

  // Magic-link token is only generated when the trainer asked us to email it.
  const magicLinkToken = options.sendMagicLink
    ? (() => {
        const plain = crypto.randomBytes(32).toString('hex')
        const hashed = crypto.createHash('sha256').update(`${plain}${env.AUTH_SECRET}`).digest('hex')
        const expires = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
        return { plain, hashed, expires }
      })()
    : null

  // If the enquiry arrived from the public booking page, resolve what to book
  // up-front so the conversion transaction can also place the session(s). The
  // package (if any) and the booking-page defaults (single-session duration /
  // type) are read here, outside the transaction.
  let booked:
    | {
        slotAt: Date
        pkg: { id: string; name: string; sessionCount: number; weeksBetween: number; durationMins: number; bufferMins: number; sessionType: import('@/generated/prisma').SessionType } | null
        duration: number
        sessionType: import('@/generated/prisma').SessionType
        title: string
      }
    | null = null
  if (enquiry.bookedSlotAt) {
    const pkg = enquiry.bookedPackageId
      ? await prisma.package.findFirst({
          where: { id: enquiry.bookedPackageId, trainerId: enquiry.trainerId },
          // bufferMins: an accepted prospect's series books with the same
          // turnaround gap as any other booking of this package.
          select: { id: true, name: true, sessionCount: true, weeksBetween: true, durationMins: true, bufferMins: true, sessionType: true },
        })
      : null
    const page = enquiry.bookedPageId
      ? await prisma.bookingPage.findUnique({
          where: { id: enquiry.bookedPageId },
          select: { slotLengthMins: true, sessionType: true, headline: true },
        })
      : null
    booked = {
      slotAt: enquiry.bookedSlotAt,
      pkg,
      duration: page?.slotLengthMins ?? 60,
      sessionType: page?.sessionType ?? 'IN_PERSON',
      title: page?.headline?.trim() || `${enquiry.trainer.businessName} session`,
    }
  }

  // Session ids created by the booking (if any), captured inside the tx so we
  // can mirror them to Google Calendar after it commits.
  let bookedSessionIds: string[] = []

  const clientProfileId = await prisma.$transaction(async tx => {
    // Find-or-join: reuse the person, join their existing profile for this
    // trainer (adding the enquiry's dog), or create a fresh profile. Never
    // duplicates a User/ClientProfile and never errors on a returning email.
    const joinResult = await findOrJoinClient(tx, {
      email: enquiry.email,
      trainerId: enquiry.trainerId,
      name: enquiry.name,
      phone: enquiry.phone,
      dogs: enquiry.dogName?.trim()
        ? [{
            name: enquiry.dogName.trim(),
            breed: enquiry.dogBreed,
            weight: enquiry.dogWeight,
            dob: enquiry.dogDob,
          }]
        : [],
      status: 'ACTIVE',
    })
    const clientProfileId = joinResult.clientProfileId

    // The session books against the dog from this enquiry when one was created;
    // otherwise fall back to the profile's existing primary dog (a join with no
    // new dog still needs a dogId for the booked session).
    let bookDogId: string | null = joinResult.createdDogIds[0] ?? null
    if (!bookDogId) {
      const profile = await tx.clientProfile.findUnique({ where: { id: clientProfileId }, select: { dogId: true } })
      bookDogId = profile?.dogId ?? null
    }

    // Place the booked session(s) onto the calendar as part of the conversion,
    // so accepting a booking-page prospect both creates/joins the client and
    // books their chosen slot.
    if (booked) {
      const { sessionIds } = await materializeBooking(tx, {
        trainerId: enquiry.trainerId,
        clientId: clientProfileId,
        dogId: bookDogId,
        slotAt: booked.slotAt,
        pkg: booked.pkg,
        singleDurationMins: booked.duration,
        singleSessionType: booked.sessionType,
        singleTitle: booked.title,
        bookingPageId: enquiry.bookedPageId,
      })
      bookedSessionIds = sessionIds
    }

    const entries = Object.entries(customFieldSnapshot).filter(([, v]) => v?.trim())
    if (entries.length > 0) {
      await tx.customFieldValue.createMany({
        data: entries.map(([fieldId, value]) => ({
          fieldId,
          clientId: clientProfileId,
          value,
        })),
      })
    }

    if (magicLinkToken) {
      await tx.verificationToken.deleteMany({ where: { identifier: enquiry.email } })
      await tx.verificationToken.create({
        data: { identifier: enquiry.email, token: magicLinkToken.hashed, expires: magicLinkToken.expires },
      })
    }

    await tx.enquiry.update({
      where: { id: enquiry.id },
      data: { status: 'ACCEPTED', clientProfileId, viewedAt: enquiry.viewedAt ?? new Date() },
    })

    return clientProfileId
  })

  // Best-effort: mirror the booked session(s) onto the trainer's Google Calendar
  // once the conversion has committed. Never blocks the accept.
  if (bookedSessionIds.length) {
    try {
      const { syncSessionsToGoogle } = await import('./google-calendar-sync')
      await syncSessionsToGoogle(bookedSessionIds)
    } catch {
      // Non-critical
    }
  }

  if (magicLinkToken) {
    // Magic link goes via NextAuth's Resend callback so the client lands logged
    // in on first click. URL host comes from the request so dev/prod both work.
    const magicLink = `${options.appUrl}/api/auth/callback/resend?${new URLSearchParams({
      callbackUrl: '/my-profile',
      token: magicLinkToken.plain,
      email: enquiry.email,
    })}`
    const businessName = enquiry.trainer.businessName
    const welcome = buildWelcomeEmail({
      form: enquiry.form,
      businessName,
      name: enquiry.name,
      message: enquiry.message,
      magicLink,
    })

    try {
      await sendEmail({
        to: enquiry.email,
        subject: welcome.subject,
        html: welcome.html,
      })
    } catch {
      // Welcome email is best-effort. The client + token already exist so the
      // trainer can resend later.
    }
  }

  return clientProfileId
}

// Platform defaults for the welcome email. Exported so the embed-form
// editor can show them as placeholders — keeping the editor and the real
// send in lock-step. {business} and {name} are substituted at send time.
export const DEFAULT_WELCOME_SUBJECT = 'Welcome to {business} — finish setting up your account'
export const DEFAULT_WELCOME_INTRO =
  'Thanks for registering with {business}. Click the button below to access your training diary — no password needed, the link logs you in automatically.'
export const DEFAULT_WELCOME_BUTTON_LABEL = 'Access my training diary'

// Substitute the supported {business}/{name} placeholders. `escape` decides
// whether the *substituted values* get HTML-escaped (true for HTML bodies,
// false for the plain-text subject line).
function fillPlaceholders(template: string, vars: { business: string; name: string }, escape: boolean): string {
  const business = escape ? escapeHtml(vars.business) : vars.business
  const name = escape ? escapeHtml(vars.name) : vars.name
  return template.replace(/\{business\}/g, business).replace(/\{name\}/g, name)
}

interface WelcomeFormConfig {
  welcomeSubject: string | null
  welcomeIntro: string | null
  welcomeShowDiaryButton: boolean
  welcomeButtonLabel: string | null
}

// Compose the magic-link welcome email from the originating form's config,
// falling back to the platform defaults for anything the trainer left blank
// (or when the form was deleted → form is null). The greeting, branding,
// and link-expiry note stay templated; only the subject, intro paragraph,
// and diary-CTA button (show/label) are trainer-controlled.
export function buildWelcomeEmail({
  form,
  businessName,
  name,
  message,
  magicLink,
}: {
  form: WelcomeFormConfig | null
  businessName: string
  name: string
  message: string | null
  magicLink: string
}): { subject: string; html: string } {
  const vars = { business: businessName, name }
  const subject = fillPlaceholders(form?.welcomeSubject?.trim() || DEFAULT_WELCOME_SUBJECT, vars, false)
  const introRaw = form?.welcomeIntro?.trim() || DEFAULT_WELCOME_INTRO
  // Intro is rich-text HTML from the editor (or a legacy plain-text default).
  // Fill placeholders first, then emailBodyToHtml sanitizes HTML / converts
  // plain text — escaping is handled there, so don't pre-escape the values.
  const introHtml = emailBodyToHtml(fillPlaceholders(introRaw, vars, false))
  const showButton = form?.welcomeShowDiaryButton ?? true
  const buttonLabel = escapeHtml(form?.welcomeButtonLabel?.trim() || DEFAULT_WELCOME_BUTTON_LABEL)

  const html = `
          <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:32px 16px;">
            <h2 style="color:#0f172a;margin-bottom:8px;">Hi ${escapeHtml(name)}!</h2>
            <div style="color:#475569;margin-bottom:24px;">${introHtml}</div>
            ${message ? `<p style="color:#475569;background:#f8fafc;border-left:3px solid #e2e8f0;padding:12px 16px;margin-bottom:24px;"><em>"${escapeHtml(message)}"</em></p>` : ''}
            ${showButton ? `<a href="${magicLink}" style="display:inline-block;background:#2563eb;color:#fff;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:600;">
              ${buttonLabel}
            </a>` : ''}
            <p style="color:#94a3b8;font-size:13px;margin-top:32px;">
              ${showButton ? 'This link expires in 14 days. ' : ''}If you didn't submit this form, you can safely ignore this email.
            </p>
          </div>
        `
  return { subject, html }
}

export class EnquiryError extends Error {
  constructor(public code: 'NOT_FOUND' | 'INVALID_STATUS' | 'USER_EXISTS' | 'FORBIDDEN', message: string) {
    super(message)
    this.name = 'EnquiryError'
  }
}

