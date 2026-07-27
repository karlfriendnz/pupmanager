import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { guardPermission } from '@/lib/membership'
import { syncGroupParticipants } from '@/lib/message-groups'

// PATCH  /api/message-groups/<id> — rename, lock/unlock, refresh membership
// DELETE /api/message-groups/<id> — delete the group and its thread
//
// Moderator actions. Scoped to the owning business first, so a group id from
// another tenant 404s exactly as if it never existed.

const patchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  /** Lock the group: still readable, no new posts. */
  archived: z.boolean().optional(),
  important: z.boolean().optional(),
  /** Re-derive membership from the class/package/membership it was built from. */
  resync: z.boolean().optional(),
})

async function ownGroup(groupId: string, trainerId: string) {
  return prisma.messageGroup.findFirst({ where: { id: groupId, trainerId }, select: { id: true, scope: true } })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ groupId: string }> }) {
  const guard = await guardPermission('messages.send')
  if (guard instanceof NextResponse) return guard
  const { groupId } = await params
  const group = await ownGroup(groupId, guard.companyId)
  if (!group) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const parsed = patchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const { name, archived, important, resync } = parsed.data

  if (name !== undefined || archived !== undefined || important !== undefined) {
    await prisma.messageGroup.update({
      where: { id: group.id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(archived !== undefined ? { archivedAt: archived ? new Date() : null } : {}),
        ...(important !== undefined ? { important } : {}),
      },
    })
  }

  let synced: { added: number; removed: number } | null = null
  if (resync) synced = await syncGroupParticipants(guard, group.id)

  return NextResponse.json({ ok: true, synced })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ groupId: string }> }) {
  const guard = await guardPermission('messages.send')
  if (guard instanceof NextResponse) return guard
  const { groupId } = await params
  const group = await ownGroup(groupId, guard.companyId)
  if (!group) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Participants and posts cascade. This does NOT unsend: the push has already
  // landed on every phone, and the UI says so.
  await prisma.messageGroup.delete({ where: { id: group.id } })
  return NextResponse.json({ ok: true })
}
