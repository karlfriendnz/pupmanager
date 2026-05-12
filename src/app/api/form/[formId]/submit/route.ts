import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { notifyEnquiryTrainer } from '@/lib/notify-enquiry-trainer'

const schema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional().nullable(),
  message: z.string().optional().nullable(),
  customFields: z.record(z.string(), z.string()).optional(),
})

// Public form submission. Creates an Enquiry in NEW state — the trainer
// reviews it and then Accepts (creates the User + ClientProfile + Dog) or
// Declines. We deliberately don't create any account here so spam and
// drive-by submissions don't pollute the user table.
export async function POST(req: Request, { params }: { params: Promise<{ formId: string }> }) {
  const { formId } = await params

  const form = await prisma.embedForm.findFirst({
    where: { id: formId, isActive: true },
    select: { id: true, trainerId: true, customFieldIds: true },
  })
  if (!form) return NextResponse.json({ error: 'Form not found' }, { status: 404 })

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const { name, email, phone, message, customFields } = parsed.data

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

  // Snapshot only the answers for fields actually enabled on this form, so a
  // later edit to the trainer's custom-field config doesn't surface stray
  // values when the enquiry is reopened.
  const customFieldSnapshot: Record<string, string> = {}
  if (customFields) {
    for (const [fieldId, value] of Object.entries(customFields)) {
      if (enabledCustomFieldIds.includes(fieldId) && value?.trim()) {
        customFieldSnapshot[fieldId] = value.trim()
      }
    }
  }

  const enquiry = await prisma.enquiry.create({
    data: {
      trainerId: form.trainerId,
      formId: form.id,
      name,
      email,
      phone: phone?.trim() || null,
      message: message?.trim() || null,
      customFieldValues: customFieldSnapshot,
    },
    select: { id: true },
  })

  // Fire-and-forget push + email to the trainer. The helper fetches
  // the full enquiry on its own and swallows errors internally so a
  // flaky APNs/Resend round-trip never fails the public form.
  await notifyEnquiryTrainer({ enquiryId: enquiry.id })

  return NextResponse.json({ ok: true }, { status: 201 })
}
