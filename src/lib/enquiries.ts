import crypto from 'crypto'
import { prisma } from './prisma'
import { env } from './env'
import { sendEmail } from './email'

// Convert an enquiry into a real client. Mirrors what the form submit
// endpoint used to do inline:
//   1. Create User (role CLIENT)
//   2. Create Dog if dog details were captured
//   3. Create ClientProfile linking user → trainer → dog
//   4. Materialise the snapshotted customFieldValues into CustomFieldValue rows
//   5. (Opt-in) Issue a NextAuth-compatible magic-link token + welcome email
//   6. Mark the enquiry ACCEPTED with a back-link to the ClientProfile
//
// `sendMagicLink` is opt-in — most trainers want to onboard manually first
// and send the diary invite later. Returns the new ClientProfile id. Throws
// if a User already exists with the enquirer's email.
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

  const existingUser = await prisma.user.findUnique({ where: { email: enquiry.email }, select: { id: true } })
  if (existingUser) throw new EnquiryError('USER_EXISTS', `An account already exists for ${enquiry.email}.`)

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

  const clientProfileId = await prisma.$transaction(async tx => {
    const clientUser = await tx.user.create({
      data: { name: enquiry.name, email: enquiry.email, role: 'CLIENT' },
    })

    let dogId: string | null = null
    if (enquiry.dogName?.trim()) {
      const dog = await tx.dog.create({
        data: {
          name: enquiry.dogName.trim(),
          breed: enquiry.dogBreed?.trim() || null,
          weight: enquiry.dogWeight ?? null,
          dob: enquiry.dogDob,
        },
      })
      dogId = dog.id
    }

    const clientProfile = await tx.clientProfile.create({
      data: {
        userId: clientUser.id,
        trainerId: enquiry.trainerId,
        dogId,
        status: 'ACTIVE',
      },
    })

    const entries = Object.entries(customFieldSnapshot).filter(([, v]) => v?.trim())
    if (entries.length > 0) {
      await tx.customFieldValue.createMany({
        data: entries.map(([fieldId, value]) => ({
          fieldId,
          clientId: clientProfile.id,
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
      data: { status: 'ACCEPTED', clientProfileId: clientProfile.id, viewedAt: enquiry.viewedAt ?? new Date() },
    })

    return clientProfile.id
  })

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
  // Trainers type plain text — escape it, then honour line breaks.
  const introHtml = fillPlaceholders(introRaw, vars, true).replace(/\n/g, '<br>')
  const showButton = form?.welcomeShowDiaryButton ?? true
  const buttonLabel = escapeHtml(form?.welcomeButtonLabel?.trim() || DEFAULT_WELCOME_BUTTON_LABEL)

  const html = `
          <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:32px 16px;">
            <h2 style="color:#0f172a;margin-bottom:8px;">Hi ${escapeHtml(name)}!</h2>
            <p style="color:#475569;margin-bottom:24px;">${introHtml}</p>
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

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
