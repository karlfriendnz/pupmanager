import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'

const client = new Anthropic()

const schema = z.object({
  formId: z.string().min(1),
  // Current draft answers from the form filler. We don't persist them here —
  // we just polish what the trainer has on screen and return the cleaned
  // version. The trainer can edit further before saving.
  answers: z.record(z.string(), z.string()),
})

interface BasicQuestion {
  id: string
  type: 'SHORT_TEXT' | 'LONG_TEXT' | 'NUMBER' | 'RATING_1_5'
  label: string
  required?: boolean
}

interface CustomFieldQuestion {
  id: string
  type: 'CUSTOM_FIELD'
  customFieldId: string
  required?: boolean
}

type Question = BasicQuestion | CustomFieldQuestion

export async function POST(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { sessionId } = await params

  const trainingSession = await prisma.trainingSession.findFirst({
    where: { id: sessionId, trainerId },
    include: {
      client: { select: { user: { select: { name: true } } } },
      dog: { select: { name: true, breed: true } },
    },
  })
  if (!trainingSession) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const form = await prisma.sessionForm.findFirst({
    where: { id: parsed.data.formId, trainerId },
  })
  if (!form) return NextResponse.json({ error: 'Form not found' }, { status: 404 })

  const questions: Question[] = Array.isArray(form.questions)
    ? (form.questions as unknown as Question[])
    : []

  // Resolve labels for CUSTOM_FIELD questions.
  const linkedIds = questions.filter(q => q.type === 'CUSTOM_FIELD').map(q => (q as CustomFieldQuestion).customFieldId)
  const linkedMeta = linkedIds.length
    ? await prisma.customField.findMany({
        where: { trainerId, id: { in: linkedIds } },
        select: { id: true, label: true },
      })
    : []
  const linkedLabel = new Map(linkedMeta.map(f => [f.id, f.label]))

  // Build the polish targets — only fields the trainer has actually written
  // something into. No need to spend tokens polishing blanks, ratings, or
  // numbers (which polishing would mangle).
  const targets = questions
    .filter(q => q.type !== 'NUMBER' && q.type !== 'RATING_1_5')
    .map(q => {
      const id = q.id
      const value = parsed.data.answers[id] ?? ''
      const label = q.type === 'CUSTOM_FIELD'
        ? (linkedLabel.get(q.customFieldId) ?? 'Notes')
        : q.label
      return { id, label, value: value.trim() }
    })
    .filter(t => t.value.length > 0)

  if (targets.length === 0) {
    return NextResponse.json({ polished: {} })
  }

  const dogName = trainingSession.dog?.name ?? 'the dog'
  const dogBreed = trainingSession.dog?.breed ? ` (${trainingSession.dog.breed})` : ''
  const clientName = trainingSession.client?.user.name ?? 'the client'

  const sysPrompt = `You are an experienced professional dog trainer writing up a session report. The trainer has dictated rough notes during a session with ${clientName} and ${dogName}${dogBreed}. Your job is to polish each note into a clear, professional, complete sentence or paragraph suitable for a client-facing report.

Rules:
- Preserve every observation and detail the trainer made — do not invent new facts.
- Expand abbreviations and shorthand into clear language.
- Fix grammar, spelling, and punctuation.
- Use a warm, encouraging, professional tone.
- Use plain text. No markdown, no bullet lists unless the original had them.
- If a note is already polished, return it largely as-is.
- Keep the response in the same language as the input.`

  const userPrompt = `Polish each of these notes. Return ONLY a JSON object mapping the input id to the polished text. No prose, no markdown fences.

Input:
${JSON.stringify(targets, null, 2)}

Expected output shape:
{ "<id>": "<polished text>", ... }`

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system: sysPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    })
    const raw = message.content[0]?.type === 'text' ? message.content[0].text : ''
    // Strip accidental code fences ("```json ... ```") and parse.
    const cleaned = raw.replace(/```(?:json)?\s*|\s*```/g, '').trim()
    const polished = JSON.parse(cleaned) as Record<string, string>
    return NextResponse.json({ polished })
  } catch (err) {
    console.error('Polish error:', err)
    return NextResponse.json({ error: 'AI polish failed. Check your ANTHROPIC_API_KEY.' }, { status: 502 })
  }
}
