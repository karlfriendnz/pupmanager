import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { guardPermission } from '@/lib/membership'
import { enforceRateLimit } from '@/lib/rate-limit'
import { prisma } from '@/lib/prisma'
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'

const client = new Anthropic()

const schema = z.object({
  clientId: z.string().min(1),
  goal: z.string().min(10).max(500),
  durationWeeks: z.coerce.number().int().min(1).max(12).default(4),
})

export async function POST(req: Request) {
  const guard = await guardPermission('ai.use')
  if (guard instanceof NextResponse) return guard
  // LLM calls cost money — cap per company to stop a script running up a bill.
  const limited = await enforceRateLimit({ key: `ai-plan:${guard.companyId}`, limit: 30, windowMs: 60 * 60_000 })
  if (limited) return limited
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const trainerProfile = await prisma.trainerProfile.findUnique({
    where: { id: session.user.trainerId ?? '' },
    select: { id: true },
  })
  if (!trainerProfile) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const { clientId, goal, durationWeeks } = parsed.data

  // Verify client belongs to trainer and fetch context
  const clientProfile = await prisma.clientProfile.findFirst({
    where: { id: clientId, trainerId: trainerProfile.id },
    include: {
      user: { select: { name: true } },
      dog: true,
    },
  })
  if (!clientProfile) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

  const dogAge = clientProfile.dog?.dob
    ? `${Math.floor((Date.now() - clientProfile.dog.dob.getTime()) / 31557600000)} years old`
    : 'unknown age'
  const dogInfo = clientProfile.dog
    ? `The dog is a ${clientProfile.dog.breed ?? 'mixed breed'}, ${dogAge}, named ${clientProfile.dog.name}.`
    : 'No dog information available.'

  const prompt = `You are an expert dog trainer assistant. Generate a structured ${durationWeeks}-week training plan for the following scenario:

Client: ${clientProfile.user.name ?? 'Unknown'}
${dogInfo}
Training goal: ${goal}

Return a JSON array of training tasks, each with:
- dayOffset (integer, day 1 through ${durationWeeks * 7})
- title (short task name, max 60 characters)
- description (2-3 sentence explanation of what to practice and how)
- repetitions (integer, optional — only for repetition-based exercises)

Focus on progressive skill building. Space tasks every 2-3 days. Return ONLY valid JSON, no markdown.`

  let text: string
  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    })
    text = message.content[0].type === 'text' ? message.content[0].text : ''
  } catch (err) {
    console.error('Anthropic API error:', err)
    return NextResponse.json({ error: 'AI service unavailable. Check your ANTHROPIC_API_KEY.' }, { status: 502 })
  }

  let tasks: unknown[]
  try {
    tasks = JSON.parse(text)
    if (!Array.isArray(tasks)) throw new Error('Not an array')
  } catch {
    return NextResponse.json({ error: 'AI returned invalid response. Please try again.' }, { status: 500 })
  }

  return NextResponse.json({ tasks })
}
