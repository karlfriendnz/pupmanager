import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { Resend } from 'resend'
import crypto from 'crypto'

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

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
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  }

  const { clientName, dogNames, clientEmail, sendInvite, emailBody } = parsed.data

  const trainerProfile = await prisma.trainerProfile.findUnique({
    where: { userId: session.user.id },
    include: { user: { select: { name: true } } },
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

    try {
      const resend = new Resend(process.env.RESEND_API_KEY)
      const result = await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL!,
        to: clientEmail,
        subject: `You've been invited to PupManager by ${trainerProfile.user.name ?? trainerProfile.businessName}`,
        html: `
          <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
            <pre style="font-family:sans-serif;white-space:pre-wrap;">${escapeHtml(personalised)}</pre>
            <p style="margin-top:24px;">
              <a href="${inviteUrl}" style="background:#2563eb;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;">
                Join PupManager
              </a>
            </p>
          </div>
        `,
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
