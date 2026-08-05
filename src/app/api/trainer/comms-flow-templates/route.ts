import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { guardPermission } from '@/lib/membership'

// Trainer-owned, reusable comms flows. Save a run's current flow as a named
// template, then apply it to another offering of the same type in one click.

export async function GET() {
  const ctx = await guardPermission('classes.manage')
  if (ctx instanceof NextResponse) return ctx

  const templates = await prisma.commsFlowTemplate.findMany({
    where: { trainerId: ctx.companyId },
    orderBy: { updatedAt: 'desc' },
  })
  // Surface a step count for the picker without shipping every body.
  return NextResponse.json(
    templates.map(t => ({
      id: t.id,
      name: t.name,
      stepCount: Array.isArray(t.steps) ? t.steps.length : 0,
      updatedAt: t.updatedAt,
    })),
  )
}

// Save from a class run OR a 1:1 package — exactly one.
const saveSchema = z.object({
  name: z.string().trim().min(1).max(120),
  runId: z.string().optional(),
  packageId: z.string().optional(),
}).refine(d => !!d.runId !== !!d.packageId, { message: 'Provide exactly one of runId / packageId' })

export async function POST(req: Request) {
  const ctx = await guardPermission('classes.manage')
  if (ctx instanceof NextResponse) return ctx

  const parsed = saveSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const { runId, packageId } = parsed.data

  // The offering must be the trainer's, and it must have steps to save.
  const owned = runId
    ? await prisma.classRun.findFirst({ where: { id: runId, trainerId: ctx.companyId }, select: { id: true } })
    : await prisma.package.findFirst({ where: { id: packageId, trainerId: ctx.companyId }, select: { id: true } })
  if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const steps = await prisma.commsFlowStep.findMany({
    where: runId ? { classRunId: runId } : { packageId },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    select: {
      direction: true, offsetMinutes: true, channels: true, audience: true,
      customClientIds: true, important: true, title: true, body: true, enabled: true,
      // The email channel's rich body is authored separately from `body`.
      // Leaving it out here silently dropped the email content on save, so a
      // template applied elsewhere fell back to the short push line.
      emailBody: true,
      // What each step IS, and how it's configured. Same lesson as emailBody:
      // a field left out of this select is a field the template quietly
      // forgets, and the copy that comes back is not the flow that was saved.
      kind: true, actor: true, trigger: true, blocking: true, payload: true,
    },
  })
  if (steps.length === 0) return NextResponse.json({ error: 'This flow has no messages to save' }, { status: 400 })

  const template = await prisma.commsFlowTemplate.create({
    data: { trainerId: ctx.companyId, name: parsed.data.name, steps },
  })
  return NextResponse.json({ id: template.id, name: template.name, stepCount: steps.length }, { status: 201 })
}
