import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { AppShell } from '@/components/shared/app-shell'
import { BookOpen, User, HelpCircle, Bell, MessageSquare } from 'lucide-react'

const clientNav = [
  { href: '/my-diary', label: 'My Diary', icon: BookOpen },
  { href: '/messages', label: 'Messages', icon: MessageSquare },
  { href: '/my-profile', label: 'My Profile', icon: User },
  { href: '/notifications', label: 'Notifications', icon: Bell },
  { href: '/help', label: 'Help', icon: HelpCircle },
]

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session || session.user.role !== 'CLIENT') redirect('/login')

  // AUTH-03: clients only see their assigned trainer's branding
  const clientProfile = await prisma.clientProfile.findUnique({
    where: { userId: session.user.id },
    include: {
      trainer: { select: { businessName: true, logoUrl: true } },
    },
  })

  return (
    <AppShell
      navItems={clientNav}
      trainerName={session.user.name ?? ''}
      trainerLogo={clientProfile?.trainer?.logoUrl}
      businessName={clientProfile?.trainer?.businessName}
    >
      {children}
    </AppShell>
  )
}
