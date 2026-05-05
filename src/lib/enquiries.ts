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
//   5. Issue a NextAuth-compatible magic-link token + welcome email
//   6. Mark the enquiry ACCEPTED with a back-link to the ClientProfile
//
// Returns the new ClientProfile id. Throws if a User already exists with
// the enquirer's email — the trainer should link manually in that case.
export async function acceptEnquiry(enquiryId: string, options: { appUrl: string }) {
  const enquiry = await prisma.enquiry.findUnique({
    where: { id: enquiryId },
    include: {
      trainer: { select: { id: true, businessName: true } },
    },
  })
  if (!enquiry) throw new EnquiryError('NOT_FOUND', 'Enquiry not found')
  if (enquiry.status !== 'NEW') throw new EnquiryError('INVALID_STATUS', `Enquiry is already ${enquiry.status.toLowerCase()}`)

  const existingUser = await prisma.user.findUnique({ where: { email: enquiry.email }, select: { id: true } })
  if (existingUser) throw new EnquiryError('USER_EXISTS', `An account already exists for ${enquiry.email}.`)

  const plainToken = crypto.randomBytes(32).toString('hex')
  const hashedToken = crypto.createHash('sha256').update(`${plainToken}${env.AUTH_SECRET}`).digest('hex')
  const expires = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)

  const customFieldSnapshot = (enquiry.customFieldValues ?? {}) as Record<string, string>

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

    await tx.verificationToken.deleteMany({ where: { identifier: enquiry.email } })
    await tx.verificationToken.create({
      data: { identifier: enquiry.email, token: hashedToken, expires },
    })

    await tx.enquiry.update({
      where: { id: enquiry.id },
      data: { status: 'ACCEPTED', clientProfileId: clientProfile.id, viewedAt: enquiry.viewedAt ?? new Date() },
    })

    return clientProfile.id
  })

  // Magic link goes via NextAuth's Resend callback so the client lands logged
  // in on first click. URL host comes from the request so dev/prod both work.
  const magicLink = `${options.appUrl}/api/auth/callback/resend?${new URLSearchParams({
    callbackUrl: '/my-profile',
    token: plainToken,
    email: enquiry.email,
  })}`
  const businessName = enquiry.trainer.businessName

  try {
    await sendEmail({
      to: enquiry.email,
      subject: `Welcome to ${businessName} — finish setting up your account`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:32px 16px;">
          <h2 style="color:#0f172a;margin-bottom:8px;">Hi ${escapeHtml(enquiry.name)}!</h2>
          <p style="color:#475569;margin-bottom:24px;">
            Thanks for registering with <strong>${escapeHtml(businessName)}</strong>.
            Click the button below to access your training diary — no password needed, the link logs you in automatically. This link expires in 14 days.
          </p>
          ${enquiry.message ? `<p style="color:#475569;background:#f8fafc;border-left:3px solid #e2e8f0;padding:12px 16px;margin-bottom:24px;"><em>"${escapeHtml(enquiry.message)}"</em></p>` : ''}
          <a href="${magicLink}" style="display:inline-block;background:#2563eb;color:#fff;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:600;">
            Access my training diary
          </a>
          <p style="color:#94a3b8;font-size:13px;margin-top:32px;">
            This link expires in 14 days. If you didn't submit this form, you can safely ignore this email.
          </p>
        </div>
      `,
    })
  } catch {
    // Welcome email is best-effort. The client + token already exist so the
    // trainer can resend later.
  }

  return clientProfileId
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
