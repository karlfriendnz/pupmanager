import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getActiveClient } from '@/lib/client-context'

// PATCH /api/my/profile — client-side endpoint for updating the
// signed-in client's own name + phone. Used by the intake form so the
// trainer's "Name / Email / Phone" required fields write back to the
// real client record (not into custom-field values).
//
// Email is intentionally not editable here: the client signed in with
// it via magic link and changing it would orphan the session. If they
// need to change email they can ask their trainer (who has the
// authority on /clients/[id]/edit).
const schema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  phone: z.string().trim().max(40).nullable().optional(),
})

export async function PATCH(req: Request) {
  const session = await auth()
  if (!session || session.user.role !== 'CLIENT') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { name, phone } = parsed.data

  if (name !== undefined) {
    await prisma.user.update({ where: { id: session.user.id }, data: { name } })
  }
  if (phone !== undefined) {
    const active = await getActiveClient()
    if (active) {
      await prisma.clientProfile.update({
        where: { id: active.clientId },
        data: { phone: phone?.trim() || null },
      })
    }
  }

  return NextResponse.json({ ok: true })
}
