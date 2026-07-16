import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { unreadBadgeCountForUser } from '@/lib/unread-messages'

// The native app-icon badge total for the signed-in user, across EVERY hat they
// wear (all companies + all client profiles). The native shell reads this on
// launch and every time it returns to the foreground and calls Badge.set(),
// so the icon count always reflects reality — including going back to 0 once
// they've read everything. Deliberately the same source sendPush() stamps on
// each outgoing push (unreadBadgeCountForUser), so the two never disagree.
export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const count = await unreadBadgeCountForUser(session.user.id)
  return NextResponse.json({ count })
}
