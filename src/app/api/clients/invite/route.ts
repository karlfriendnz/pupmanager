import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import crypto from 'crypto'
import { sendEmail, fromTrainer } from '@/lib/email'
import { escapeHtml } from '@/lib/enquiries'

const schema = z.object({
  clientName: z.string().min(2),
  dogNames: z.array(z.string().min(1)).min(1),
  clientEmail: z.string().email(),
  sendInvite: z.boolean().default(true),
  emailBody: z.string().optional(),
})

export async function POST(req: Request) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    // Surface the first field-level error so the form can show "Email isn't
    // valid" etc. instead of a generic "Invalid input". flatten() also keeps
    // the structured details available for callers that want them.
    const flat = parsed.error.flatten()
    const firstField = Object.entries(flat.fieldErrors)[0]
    const message = firstField?.[1]?.[0]
      ?? flat.formErrors[0]
      ?? 'Invalid input'
    return NextResponse.json({ error: message, details: flat }, { status: 400 })
  }

  const { clientName, dogNames, clientEmail, sendInvite, emailBody } = parsed.data

  const trainerProfile = await prisma.trainerProfile.findUnique({
    where: { userId: session.user.id },
    select: {
      id: true,
      businessName: true,
      logoUrl: true,
      emailAccentColor: true,
      user: { select: { name: true, email: true } },
    },
  })
  if (!trainerProfile) {
    return NextResponse.json({ error: 'Trainer profile not found' }, { status: 404 })
  }

  // Prevent duplicate invites
  const existingUser = await prisma.user.findUnique({ where: { email: clientEmail } })
  if (existingUser) {
    return NextResponse.json({ error: 'A user with this email already exists.' }, { status: 409 })
  }

  // Create a pending client user and profile
  const inviteToken = crypto.randomBytes(32).toString('hex')
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days

  await prisma.$transaction(async (tx) => {
    const clientUser = await tx.user.create({
      data: {
        name: clientName,
        email: clientEmail,
        role: 'CLIENT',
      },
    })

    // Create the primary dog
    const primaryDog = await tx.dog.create({
      data: { name: dogNames[0] },
    })

    // Create additional dogs
    const additionalDogs = await Promise.all(
      dogNames.slice(1).map(name => tx.dog.create({ data: { name } }))
    )

    await tx.clientProfile.create({
      data: {
        userId: clientUser.id,
        trainerId: trainerProfile.id,
        dogId: primaryDog.id,
        dogs: additionalDogs.length > 0
          ? { connect: additionalDogs.map(d => ({ id: d.id })) }
          : undefined,
      },
    })

    // Store invite token for magic-link style onboarding
    await tx.verificationToken.create({
      data: {
        identifier: clientEmail,
        token: inviteToken,
        expires,
      },
    })
  })

  let emailError: string | null = null

  if (sendInvite && emailBody) {
    const dogNamesFormatted = dogNames.length === 1
      ? dogNames[0]
      : dogNames.slice(0, -1).join(', ') + ' and ' + dogNames[dogNames.length - 1]
    const personalised = emailBody
      .replace(/{{clientName}}/g, clientName)
      .replace(/{{dogName}}/g, dogNamesFormatted)

    const inviteUrl = `${process.env.NEXT_PUBLIC_APP_URL}/invite?token=${inviteToken}&email=${encodeURIComponent(clientEmail)}`

    // Build the same branded shell used by the enquiry-reply email so trainer
    // outbound mail is visually consistent: white card, accent strip,
    // logo/initial avatar, plain-text → paragraph HTML conversion, gradient
    // CTA, "Sent with PupManager" footer.
    const displayName = trainerProfile.user.name?.trim() || trainerProfile.businessName
    const trainerEmail = trainerProfile.user.email
    const businessName = trainerProfile.businessName
    const logoUrl = trainerProfile.logoUrl
    const bgColor = '#F8FAFC'
    const validHex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/
    const accentColor = trainerProfile.emailAccentColor && validHex.test(trainerProfile.emailAccentColor)
      ? trainerProfile.emailAccentColor
      : '#7c3aed'

    const htmlBody = personalised
      .split(/\n{2,}/)
      .map(para => `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#0f172a;">${escapeHtml(para).replace(/\n/g, '<br />')}</p>`)
      .join('')

    const safeBusiness = escapeHtml(businessName)
    const safeDisplay = escapeHtml(displayName)
    const initial = escapeHtml(businessName.charAt(0).toUpperCase())

    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${safeBusiness}</title>
</head>
<body style="margin:0;padding:0;background:${bgColor};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${safeDisplay} invited you to join their training app.</div>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:${bgColor};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:560px;">
          <tr>
            <td style="background:#ffffff;border-radius:18px;box-shadow:0 1px 3px rgba(15,23,42,0.04),0 8px 24px rgba(15,23,42,0.06);overflow:hidden;">
              <div style="height:4px;background:${accentColor};"></div>
              <div style="padding:32px 32px 16px;text-align:center;">
                ${logoUrl
                  ? `<img src="${logoUrl}" alt="${safeBusiness}" style="max-height:88px;max-width:300px;display:inline-block;border:0;" />`
                  : `<div style="display:inline-flex;align-items:center;justify-content:center;width:72px;height:72px;border-radius:18px;background:${accentColor};color:#ffffff;font-size:28px;font-weight:700;line-height:72px;">${initial}</div>`}
                <p style="margin:12px 0 0;font-size:14px;font-weight:600;color:#0f172a;letter-spacing:0.01em;">${safeBusiness}</p>
              </div>
              <div style="padding:8px 32px 8px;">
                ${htmlBody}
              </div>
              <div style="padding:8px 32px 32px;text-align:center;">
                <a href="${inviteUrl}" style="display:inline-block;padding:14px 28px;border-radius:12px;background:${accentColor};color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;line-height:1;">Join ${safeBusiness}</a>
              </div>
              <div style="padding:20px 32px;background:#fafaf9;border-top:1px solid #f1f5f9;">
                <p style="margin:0;font-size:13px;color:#475569;line-height:1.5;">
                  <strong style="color:#0f172a;">${safeDisplay}</strong>
                  <span style="color:#94a3b8;"> · ${safeBusiness}</span>
                </p>
                <p style="margin:6px 0 0;font-size:12px;color:#94a3b8;line-height:1.5;">
                  Hit reply to this email to reach ${safeDisplay} directly.
                </p>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 8px;text-align:center;">
              <p style="margin:0;font-size:11px;color:#333333;letter-spacing:0.04em;text-transform:uppercase;">
                Sent with <a href="https://pupmanager.com" style="color:#333333;text-decoration:none;font-weight:600;">PupManager</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

    try {
      const result = await sendEmail({
        to: clientEmail,
        subject: `You've been invited to ${businessName} on PupManager`,
        from: fromTrainer(displayName),
        replyTo: trainerEmail ?? undefined,
        text: `${personalised}\n\nJoin ${businessName}: ${inviteUrl}`,
        html,
      })
      if (result.error) {
        console.error('[invite] Resend error:', result.error)
        emailError = result.error.message
      }
    } catch (err) {
      console.error('[invite] Failed to send email:', err)
      emailError = err instanceof Error ? err.message : 'Unknown error'
    }
  }

  return NextResponse.json(
    { ok: true, ...(emailError ? { emailError } : {}) },
    { status: 201 }
  )
}
