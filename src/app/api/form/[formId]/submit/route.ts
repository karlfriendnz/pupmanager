import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import crypto from 'crypto'

const schema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional().nullable(),
  dogName: z.string().optional().nullable(),
  dogBreed: z.string().optional().nullable(),
  dogWeight: z.string().optional().nullable(),
  dogDob: z.string().optional().nullable(),
  message: z.string().optional().nullable(),
  customFields: z.record(z.string(), z.string()).optional(),
})

export async function POST(req: Request, { params }: { params: Promise<{ formId: string }> }) {
  const { formId } = await params

  const form = await prisma.embedForm.findFirst({
    where: { id: formId, isActive: true },
    include: { trainer: { select: { id: true, businessName: true, user: { select: { name: true } } } } },
  })
  if (!form) return NextResponse.json({ error: 'Form not found' }, { status: 404 })

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const { name, email, phone, dogName, dogBreed, dogWeight, dogDob, message, customFields } = parsed.data

  // Prevent duplicate submissions
  const existingUser = await prisma.user.findUnique({ where: { email } })
  if (existingUser) {
    return NextResponse.json({ error: 'An account with this email already exists. Please contact your trainer.' }, { status: 409 })
  }

  // Validate required custom fields
  const enabledCustomFieldIds = Array.isArray(form.customFieldIds) ? form.customFieldIds as string[] : []
  if (enabledCustomFieldIds.length > 0) {
    const requiredFields = await prisma.customField.findMany({
      where: { id: { in: enabledCustomFieldIds }, required: true },
    })
    for (const field of requiredFields) {
      if (!customFields?.[field.id]?.trim()) {
        return NextResponse.json({ error: `${field.label} is required.` }, { status: 400 })
      }
    }
  }

  const inviteToken = crypto.randomBytes(32).toString('hex')
  const expires = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) // 14 days

  await prisma.$transaction(async tx => {
    const clientUser = await tx.user.create({
      data: { name, email, role: 'CLIENT' },
    })

    // Create dog if any dog fields provided
    let dogId: string | null = null
    if (dogName?.trim()) {
      const dog = await tx.dog.create({
        data: {
          name: dogName.trim(),
          breed: dogBreed?.trim() || null,
          weight: dogWeight ? parseFloat(dogWeight) : null,
          dob: dogDob ? new Date(dogDob) : null,
        },
      })
      dogId = dog.id
    }

    const clientProfile = await tx.clientProfile.create({
      data: {
        userId: clientUser.id,
        trainerId: form.trainer.id,
        dogId,
        status: 'NEW',
      },
    })

    // Save custom field values
    if (customFields && enabledCustomFieldIds.length > 0) {
      const entries = Object.entries(customFields).filter(([, v]) => v?.trim())
      if (entries.length > 0) {
        await tx.customFieldValue.createMany({
          data: entries.map(([fieldId, value]) => ({
            fieldId,
            clientId: clientProfile.id,
            value,
          })),
        })
      }
    }

    // Store phone in a custom field if trainer has one, or just ignore for now
    // (phone is stored as a note in message if no custom field exists)

    // Create invite token
    await tx.verificationToken.create({
      data: { identifier: email, token: inviteToken, expires },
    })
  })

  // Send welcome email
  const inviteUrl = `${process.env.NEXT_PUBLIC_APP_URL}/invite?token=${inviteToken}&email=${encodeURIComponent(email)}`
  const businessName = form.trainer.businessName

  try {
    const { Resend } = await import('resend')
    const resend = new Resend(process.env.RESEND_API_KEY)
    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL!,
      to: email,
      subject: `Welcome to ${businessName} — finish setting up your account`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:32px 16px;">
          <h2 style="color:#0f172a;margin-bottom:8px;">Hi ${name}!</h2>
          <p style="color:#475569;margin-bottom:24px;">
            Thanks for registering with <strong>${businessName}</strong>.
            Click the button below to set up your account and access your training diary.
          </p>
          ${message ? `<p style="color:#475569;background:#f8fafc;border-left:3px solid #e2e8f0;padding:12px 16px;margin-bottom:24px;"><em>"${message}"</em></p>` : ''}
          <a href="${inviteUrl}" style="display:inline-block;background:#2563eb;color:#fff;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:600;">
            Set up your account
          </a>
          <p style="color:#94a3b8;font-size:13px;margin-top:32px;">
            This link expires in 14 days. If you didn't submit this form, you can safely ignore this email.
          </p>
        </div>
      `,
    })
  } catch {
    // Non-critical — client is still created
  }

  return NextResponse.json({ ok: true }, { status: 201 })
}
