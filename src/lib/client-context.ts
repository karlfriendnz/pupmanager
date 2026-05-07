// Resolves the "active client" for any request inside the (client) route
// group. Either the signed-in client themselves, or — when a trainer has
// entered preview mode for one of their clients — the client behind the
// preview cookie. This is the one place every (client) page consults so that
// preview mode "just works" without each page needing role-aware branches.

import { cache } from 'react'
import { cookies } from 'next/headers'
import { auth } from './auth'
import { prisma } from './prisma'

export const PREVIEW_COOKIE = 'pm-preview-client'

export interface ActiveClient {
  clientId: string
  // The user id of the client account (NOT the trainer's). Use this whenever
  // a query needs to scope to "this client's user" — notifications, message
  // sender filters, profile fields.
  userId: string
  // True when a trainer is previewing rather than the real client logged in.
  isPreview: boolean
  // The id of the actually-signed-in user (the trainer's id when previewing).
  // Useful for telemetry / mutation guards.
  actualUserId: string
}

// Wrapped in React `cache()` so the layout and the page both call it without
// firing two separate session+cookie+DB lookups per render — important for
// staying under the Supabase pool size on deeply-rendered routes.
export const getActiveClient = cache(async (): Promise<ActiveClient | null> => {
  const session = await auth()
  if (!session) return null

  if (session.user.role === 'TRAINER' && session.user.trainerId) {
    const store = await cookies()
    const previewId = store.get(PREVIEW_COOKIE)?.value
    if (!previewId) return null
    const client = await prisma.clientProfile.findFirst({
      where: { id: previewId, trainerId: session.user.trainerId },
      select: { id: true, userId: true },
    })
    if (!client) return null
    return {
      clientId: client.id,
      userId: client.userId,
      isPreview: true,
      actualUserId: session.user.id,
    }
  }

  if (session.user.role === 'CLIENT') {
    const client = await prisma.clientProfile.findUnique({
      where: { userId: session.user.id },
      select: { id: true, userId: true },
    })
    if (!client) return null
    return {
      clientId: client.id,
      userId: client.userId,
      isPreview: false,
      actualUserId: session.user.id,
    }
  }

  return null
})
