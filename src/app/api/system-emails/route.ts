import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { SYSTEM_EMAILS, SYSTEM_EMAIL_KEYS, systemEmailDef } from '@/lib/system-emails'

// The platform's own emails, with whatever the trainer has changed applied on
// top. Every entry always comes back — an email with no override reports its
// built-in default and `customised: false`, so the editor can show the real
// wording without the caller knowing which is which.

async function trainerId(): Promise<string | null> {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') return null
  return session.user.trainerId ?? null
}

export async function GET() {
  const tid = await trainerId()
  if (!tid) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  // The invite's wording has lived on the trainer's profile since long before
  // this screen existed, and three senders read it there. Keeping it in place
  // and surfacing it here means one store, not two saying different things.
  const profile = await prisma.trainerProfile.findUnique({
    where: { id: tid },
    select: { inviteTemplate: true },
  })

  const rows = await prisma.emailTemplate.findMany({
    where: { trainerId: tid, systemKey: { in: SYSTEM_EMAIL_KEYS } },
    select: { systemKey: true, subject: true, body: true, bodyBlocks: true },
  })
  const bySystemKey = new Map(rows.map(r => [r.systemKey!, r]))

  const emails = SYSTEM_EMAILS.map(def => {
    const saved = def.key === 'client_invite'
      ? (profile?.inviteTemplate?.trim() ? { subject: '', body: profile.inviteTemplate } : undefined)
      : bySystemKey.get(def.key)
    return {
      key: def.key,
      label: def.label,
      description: def.description,
      audience: def.audience,
      trigger: def.trigger,
      placeholders: def.placeholders,
      subjectEditable: def.subjectEditable !== false,
      subject: saved?.subject ?? def.defaultSubject,
      body: saved?.body ?? def.defaultBody,
      // What the editor loads. Absent for an email never edited (and for the
      // invite, which lives on the profile as plain text) — the client then
      // opens the default wording as a single text block.
      bodyBlocks: (saved && 'bodyBlocks' in saved ? saved.bodyBlocks : null) ?? null,
      defaultSubject: def.defaultSubject,
      defaultBody: def.defaultBody,
      customised: !!saved,
    }
  })
  return NextResponse.json({ emails })
}

const blockSchema = z.discriminatedUnion('type', [
  z.object({ id: z.string(), type: z.literal('text'), html: z.string().max(20000) }),
  z.object({ id: z.string(), type: z.literal('image'), url: z.string().max(2000), link: z.string().max(2000).optional() }),
])

const saveSchema = z.object({
  key: z.string().min(1),
  subject: z.string().max(300),
  // The HTML that sends — serialised by the client from the blocks below, so
  // the two always describe the same email.
  body: z.string().max(40000),
  blocks: z.array(blockSchema).max(50).optional(),
})

export async function PUT(req: Request) {
  const tid = await trainerId()
  if (!tid) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const parsed = saveSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const def = systemEmailDef(parsed.data.key)
  if (!def) return NextResponse.json({ error: 'Unknown email' }, { status: 404 })

  // `name` is required on the table and shown nowhere for a system row, so it
  // carries the label — a row in the database still reads as what it is.
  if (def.key === 'client_invite') {
    await prisma.trainerProfile.update({
      where: { id: tid },
      data: { inviteTemplate: parsed.data.body },
    })
    return NextResponse.json({ ok: true })
  }

  await prisma.emailTemplate.upsert({
    where: { trainerId_systemKey: { trainerId: tid, systemKey: def.key } },
    create: {
      trainerId: tid,
      systemKey: def.key,
      name: def.label,
      category: 'system',
      subject: parsed.data.subject,
      body: parsed.data.body,
      bodyBlocks: parsed.data.blocks ?? undefined,
    },
    update: {
      subject: parsed.data.subject,
      body: parsed.data.body,
      bodyBlocks: parsed.data.blocks ?? undefined,
    },
  })
  return NextResponse.json({ ok: true })
}

// Putting the wording back to ours — deleting the override IS the reset, so
// the sender falls through to the default again with nothing left behind.
export async function DELETE(req: Request) {
  const tid = await trainerId()
  if (!tid) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const key = new URL(req.url).searchParams.get('key')
  if (!key || !systemEmailDef(key)) return NextResponse.json({ error: 'Unknown email' }, { status: 404 })
  if (key === 'client_invite') {
    await prisma.trainerProfile.update({ where: { id: tid }, data: { inviteTemplate: null } })
  } else {
    await prisma.emailTemplate.deleteMany({ where: { trainerId: tid, systemKey: key } })
  }
  return NextResponse.json({ ok: true })
}
