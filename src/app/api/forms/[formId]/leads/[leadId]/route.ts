import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { Resend } from 'resend'
import crypto from 'crypto'

const patchSchema = z.object({
  status: z.enum(['NEW', 'CONTACTED', 'ARCHIVED', 'REJECTED', 'CONVERTED']).optional(),
})

async function getTrainerAndLead(formId: string, leadId: string, userId: string) {
  const trainerProfile = await prisma.trainerProfile.findUnique({
    where: { userId },
    include: { user: { select: { name: true } } },
  })
  if (!trainerProfile) return null

  const form = await prisma.intakeForm.findFirst({
    where: { id: formId, trainerId: trainerProfile.id },
  })
  if (!form) return null

  const lead = await prisma.formSubmission.findFirst({
    where: { id: leadId, formId },
  })
  if (!lead) return null

  return { trainerProfile, form, lead }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ formId: string; leadId: string }> }
) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const { formId, leadId } = await params
  const ctx = await getTrainerAndLead(formId, leadId, session.user.id)
  if (!ctx) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const updated = await prisma.formSubmission.update({
    where: { id: leadId },
    data: parsed.data,
  })

  return NextResponse.json(updated)
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ formId: string; leadId: string }> }
) {
  // Convert lead → client
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const { formId, leadId } = await params
  const ctx = await getTrainerAndLead(formId, leadId, session.user.id)
  if (!ctx) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { trainerProfile, lead } = ctx

  if (!lead.email) {
    return NextResponse.json({ error: 'Lead has no email address.' }, { status: 422 })
  }

  const existingUser = await prisma.user.findUnique({ where: { email: lead.email } })
  if (existingUser) {
    return NextResponse.json({ error: 'A user with this email already exists.' }, { status: 409 })
  }

  const inviteToken = crypto.randomBytes(32).toString('hex')
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

  await prisma.$transaction(async tx => {
    const clientUser = await tx.user.create({
      data: {
        name: lead.name ?? undefined,
        email: lead.email!,
        role: 'CLIENT',
      },
    })

    const dog = await tx.dog.create({
      data: { name: lead.dogName ?? 'My Dog' },
    })

    await tx.clientProfile.create({
      data: {
        userId: clientUser.id,
        trainerId: trainerProfile.id,
        dogId: dog.id,
      },
    })

    await tx.verificationToken.create({
      data: { identifier: lead.email!, token: inviteToken, expires },
    })

    await tx.formSubmission.update({
      where: { id: leadId },
      data: { status: 'CONVERTED' },
    })
  })

  const inviteUrl = `${process.env.NEXT_PUBLIC_APP_URL}/invite?token=${inviteToken}&email=${encodeURIComponent(lead.email)}`
  const resend = new Resend(process.env.RESEND_API_KEY)
  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL!,
    to: lead.email,
    subject: `You've been accepted — join K9Tracker`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
        <h2>Hi ${lead.name ?? 'there'} 👋</h2>
        <p>${trainerProfile.user.name ?? trainerProfile.businessName} has accepted your enquiry and set up your K9Tracker account.</p>
        <p style="margin-top:24px;">
          <a href="${inviteUrl}" style="background:#2563eb;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;">
            Set up my account →
          </a>
        </p>
      </div>
    `,
  })

  return NextResponse.json({ ok: true })
}
