import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getActiveClient } from '@/lib/client-context'
import { ClientProfileForm } from './client-profile-form'
import { LegacyTabRedirect } from './legacy-tab-redirect'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'My Profile' }

// Where the two tabs that used to live here went. Anything still pointing at
// them (an old email link, a bookmark, a nav label) lands on the real page
// rather than a blank tab — see also legacy-tab-redirect.tsx, which does the
// same for the `#hash` form the server can't see.
export const MOVED_TABS: Record<string, string> = {
  dogs: '/my-dogs',
  notifications: '/my-notifications?tab=settings',
}

export default async function ClientProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const { tab } = await searchParams
  const moved = tab ? MOVED_TABS[tab] : undefined
  if (moved) redirect(moved)

  const active = await getActiveClient()
  if (!active) redirect('/login')

  const user = await prisma.user.findUnique({
    where: { id: active.userId },
    select: { name: true, email: true, timezone: true, notifyEmail: true, notifyPush: true },
  })
  if (!user) redirect('/login')

  return (
    <div className="px-5 lg:px-8 py-6 max-w-3xl mx-auto w-full">
      <LegacyTabRedirect />
      <h1 className="text-2xl font-bold text-slate-900 mb-8">My Profile</h1>
      {/* No tab strip: with dogs on /my-dogs and notifications on
          /my-notifications, one lonely tab is chrome that earns nothing. */}
      <ClientProfileForm user={user} />
    </div>
  )
}
