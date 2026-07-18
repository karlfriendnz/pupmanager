import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export default async function Home() {
  const session = await auth()

  if (!session) redirect('/login')
  if (session.user.role === 'ADMIN') redirect('/admin')
  if (session.user.role === 'CLIENT') redirect('/home')

  // Trainer: honour their chosen landing page (Dashboard or Schedule).
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { landingPage: true },
  })
  redirect(user?.landingPage === 'schedule' ? '/schedule' : '/dashboard')
}
