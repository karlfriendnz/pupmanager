import { redirect } from 'next/navigation'
import { auth, signOut } from '@/lib/auth'
import { AdminTabNav } from './admin-tab-nav'
import { AdminBottomNav } from './admin-bottom-nav'
import { AdminTopSearch } from './admin-top-search'
import type { ReactNode } from 'react'

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await auth()
  if (!session || session.user.role !== 'ADMIN') redirect('/login')

  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col">
      {/* Admin top bar. The wrapper pads env(safe-area-inset-top) so the slate
          bar fills behind the iOS status bar / notch on iPad + iPhone (the admin
          area isn't inside the app-shell that normally reserves this). */}
      <header className="border-b border-slate-700 bg-slate-800" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        <div className="flex items-center justify-between gap-3 sm:gap-6 px-4 sm:px-6 h-14">
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <span className="text-lg">🐾</span>
            <span className="font-semibold">PupManager Admin</span>
            <span className="text-xs bg-red-600 px-2 py-0.5 rounded-full hidden sm:inline">Super Admin</span>
          </div>
          {/* Desktop nav in the top bar. On mobile the fixed AdminBottomNav takes
              over, so this is hidden below md. */}
          <div className="min-w-0 hidden md:block">
            <AdminTabNav />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* Phone-only: the Businesses search lives below the tabs on that
                page, which is off screen from every other admin view. */}
            <AdminTopSearch />
            <form action={async () => { 'use server'; await signOut({ redirectTo: '/login' }) }}>
              <button type="submit" className="text-xs text-slate-400 hover:text-white">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      {/* pb-24 (mobile) clears the fixed bottom nav; md:pb-6 restores normal
          spacing once the top bar takes over. Split padding axes so the bottom
          value survives — a p-6 shorthand at sm would otherwise shrink it while
          the bottom nav is still on screen (it shows up to md). */}
      <main className="flex-1 px-4 sm:px-6 pt-4 sm:pt-6 pb-24 md:pb-6 w-full">{children}</main>
      <AdminBottomNav />
    </div>
  )
}
