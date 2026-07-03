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
})

export async function POST(req: Request) {
  const guard = await guardPermission('ai.use')
  if (guard instanceof NextResponse) return guard
  const limited = await enforceRateLimit({ key: `ai-summary:${guard.companyId}`, limit: 30, windowMs: 60 * 60_000 })
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

  const { clientId } = parsed.data

  const clientProfile = await prisma.clientProfile.findFirst({
    where: { id: clientId, trainerId: trainerProfile.id },
    include: {
      user: { select: { name: true } },
      dog: true,
    },
  })
  if (!clientProfile) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

  // Fetch last 30 days of tasks
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  const tasks = await prisma.trainingTask.findMany({
    where: { clientId, date: { gte: thirtyDaysAgo } },
    include: { completion: true },
    orderBy: { date: 'asc' },
  })

  const totalTasks = tasks.length
  const completedTasks = tasks.filter(t => t.completion).length
  const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0

  const taskSummary = tasks.map(t => ({
    date: t.date.toISOString().split('T')[0],
    title: t.title,
    completed: !!t.completion,
    note: t.completion?.note ?? null,
  }))

  const prompt = `You are an expert dog trainer assistant. Write a concise progress summary for a trainer to review.

Client: ${clientProfile.user.name ?? 'Unknown'}
Dog: ${clientProfile.dog?.name ?? 'Unknown'} (${clientProfile.dog?.breed ?? 'unknown breed'})
Period: last 30 days
Overall completion rate: ${completionRate}% (${completedTasks} of ${totalTasks} tasks completed)

Task details:
${JSON.stringify(taskSummary, null, 2)}

Write a 2-3 paragraph summary covering:
1. Overall performance and consistency
2. Specific patterns or areas of strength/weakness based on which tasks were completed
3. Suggestions for the trainer on what to focus on next

Use an encouraging, professional tone. Write in plain text, no markdown formatting.`

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    })

    const summary = message.content[0].type === 'text' ? message.content[0].text : ''
    return NextResponse.json({ summary, stats: { totalTasks, completedTasks, completionRate } })
  } catch (err) {
    console.error('Anthropic API error:', err)
    return NextResponse.json({ error: 'AI service unavailable. Check your ANTHROPIC_API_KEY.' }, { status: 502 })
  }
}
