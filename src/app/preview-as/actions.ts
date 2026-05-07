'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { PREVIEW_COOKIE } from '@/lib/client-context'

// One-hour preview window. Long enough for a thorough walk-through, short
// enough that a forgotten cookie doesn't keep the trainer "logged in" as
// a client across sessions.
const PREVIEW_TTL_SECONDS = 60 * 60

export async function enterClientPreview(clientId: string) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER' || !session.user.trainerId) {
    throw new Error('Unauthorised')
  }
  const client = await prisma.clientProfile.findFirst({
    where: { id: clientId, trainerId: session.user.trainerId },
    select: { id: true },
  })
  if (!client) throw new Error('Client not found')

  const store = await cookies()
  store.set(PREVIEW_COOKIE, clientId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: PREVIEW_TTL_SECONDS,
  })
  redirect('/home')
}

export async function exitClientPreview(returnTo?: string) {
  const store = await cookies()
  const previewId = store.get(PREVIEW_COOKIE)?.value
  store.delete(PREVIEW_COOKIE)
  if (returnTo) redirect(returnTo)
  if (previewId) redirect(`/clients/${previewId}`)
  redirect('/dashboard')
}
