import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const schema = z.object({
  answers: z.array(z.object({
    fieldId: z.string(),
    value: z.union([z.string(), z.array(z.string())]),
  })),
  name: z.string().optional(),
  email: z.string().email().optional(),
  dogName: z.string().optional(),
})

export async function POST(
  req: Request,
  { params }: { params: Promise<{ formId: string }> }
) {
  const { formId } = await params

  const form = await prisma.intakeForm.findUnique({
    where: { id: formId, isPublished: true },
    include: { sections: { include: { fields: true } } },
  })
  if (!form) return NextResponse.json({ error: 'Form not found' }, { status: 404 })

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid submission' }, { status: 400 })

  // Validate required fields
  const allFields = form.sections.flatMap(s => s.fields)
  const answerMap = new Map(parsed.data.answers.map(a => [a.fieldId, a.value]))
  const missing = allFields.filter(f => f.required && !answerMap.get(f.id))
  if (missing.length > 0) {
    return NextResponse.json({ error: 'Please fill in all required fields.' }, { status: 422 })
  }

  const submission = await prisma.formSubmission.create({
    data: {
      formId,
      answers: parsed.data.answers,
      name: parsed.data.name,
      email: parsed.data.email,
      dogName: parsed.data.dogName,
    },
  })

  return NextResponse.json({ ok: true, id: submission.id }, { status: 201 })
}
