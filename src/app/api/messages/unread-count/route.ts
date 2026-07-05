import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getActiveClient } from '@/lib/client-context'
import { countUnreadMessages } from '@/lib/unread-messages'

// Lightweight unread-count endpoint for the live nav-badge poll. Scoped exactly
// like the layouts: a client sees their active thread's unread; a trainer sees
// their company's; a trainer previewing the client app gets 0.
export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  // Client-app view (a real client, or a trainer previewing → 0 like the layout).
  const active = await getActiveClient()
  if (active) {
    if (active.isPreview) return NextResponse.json({ count: 0 })
    const count = await countUnreadMessages({ kind: 'client', clientId: active.clientId, userId: session.user.id })
    return NextResponse.json({ count })
  }

  // Trainer view.
  if (session.user.role === 'TRAINER' && session.user.trainerId) {
    const count = await countUnreadMessages({ kind: 'trainer', companyId: session.user.trainerId, userId: session.user.id })
    return NextResponse.json({ count })
  }

  return NextResponse.json({ count: 0 })
}
