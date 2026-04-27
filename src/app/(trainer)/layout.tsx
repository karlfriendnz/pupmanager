import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { AppShell } from '@/components/shared/app-shell'

export default async function TrainerLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') redirect('/login')

  return (
    <AppShell
      role="TRAINER"
      userName={session.user.name ?? ''}
      userEmail={session.user.email ?? ''}
      trainerLogo={session.user.logoUrl}
      businessName={session.user.businessName}
    >
      {children}
    </AppShell>
  )
}
