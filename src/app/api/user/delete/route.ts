import { NextResponse } from 'next/server'
import { auth, signOut } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function DELETE() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  // Cascade delete handled by Prisma schema (onDelete: Cascade on related records)
  await prisma.user.delete({ where: { id: session.user.id } })

  return NextResponse.json({ ok: true })
}
