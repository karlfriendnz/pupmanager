import { redirect } from 'next/navigation'
import { auth, signOut } from '@/lib/auth'
import { AdminTabNav } from './admin-tab-nav'
import type { ReactNode } from 'react'

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await auth()
  if (!session || session.user.role !== 'ADMIN') redirect('/login')

  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col">
      {/* Admin top bar */}
      <header className="flex items-center justify-between gap-3 sm:gap-6 px-4 sm:px-6 h-14 border-b border-slate-700 bg-slate-800">
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <span className="text-lg">🐾</span>
          <span className="font-semibold hidden sm:inline">PupManager Admin</span>
          <span className="text-xs bg-red-600 px-2 py-0.5 rounded-full hidden sm:inline">Super Admin</span>
        </div>
        {/* min-w-0 lets the nav shrink below its content width on mobile so the
            tabs scroll horizontally instead of pushing Sign out off-screen. */}
        <div className="min-w-0">
          <AdminTabNav />
        </div>
        <form action={async () => { 'use server'; await signOut({ redirectTo: '/login' }) }} className="shrink-0">
          <button type="submit" className="text-xs text-slate-400 hover:text-white">Sign out</button>
        </form>
      </header>
      <main className="flex-1 p-4 sm:p-6 w-full">{children}</main>
    </div>
  )
}
