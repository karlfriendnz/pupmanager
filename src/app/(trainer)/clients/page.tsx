import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { UserPlus, Search, Dog } from 'lucide-react'
import { getInitials, formatDate } from '@/lib/utils'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Clients' }

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: { q?: string; archived?: string }
}) {
  const session = await auth()
  if (!session) redirect('/login')

  const trainerProfile = await prisma.trainerProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  })
  if (!trainerProfile) redirect('/onboarding')

  const showArchived = searchParams.archived === '1'
  const query = searchParams.q ?? ''

  const clients = await prisma.clientProfile.findMany({
    where: {
      trainerId: trainerProfile.id,
      user: query
        ? { name: { contains: query, mode: 'insensitive' } }
        : undefined,
    },
    include: {
      user: { select: { name: true, email: true } },
      dog: { select: { name: true, breed: true } },
      diaryEntries: {
        where: { date: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
        select: { id: true, completion: { select: { id: true } } },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Clients</h1>
          <p className="text-sm text-slate-500 mt-0.5">{clients.length} active client{clients.length !== 1 ? 's' : ''}</p>
        </div>
        <Link href="/clients/invite">
          <Button size="sm">
            <UserPlus className="h-4 w-4" />
            Invite client
          </Button>
        </Link>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <form>
          <input
            name="q"
            defaultValue={query}
            placeholder="Search clients..."
            className="w-full h-11 pl-10 pr-4 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </form>
      </div>

      {clients.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <Dog className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No clients yet</p>
          <p className="text-sm mt-1">Invite your first client to get started</p>
          <Link href="/clients/invite" className="mt-4 inline-block">
            <Button size="sm">
              <UserPlus className="h-4 w-4" />
              Invite client
            </Button>
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {clients.map((client) => {
            const taskCount = client.diaryEntries.length
            const completedCount = client.diaryEntries.filter(t => t.completion).length
            const complianceRate = taskCount > 0 ? Math.round((completedCount / taskCount) * 100) : null

            return (
              <Link key={client.id} href={`/clients/${client.id}`}>
                <Card className="p-4 hover:border-blue-200 hover:shadow-md transition-all cursor-pointer">
                  <div className="flex items-center gap-4">
                    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-blue-100 text-blue-700 font-semibold text-sm flex-shrink-0">
                      {getInitials(client.user.name ?? client.user.email)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-slate-900 truncate">
                        {client.user.name ?? client.user.email}
                      </p>
                      <p className="text-sm text-slate-500 truncate">
                        {client.dog ? `🐕 ${client.dog.name}${client.dog.breed ? ` · ${client.dog.breed}` : ''}` : 'No dog added yet'}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      {complianceRate !== null ? (
                        <>
                          <p className={`text-lg font-bold ${complianceRate >= 70 ? 'text-green-600' : complianceRate >= 40 ? 'text-amber-600' : 'text-red-500'}`}>
                            {complianceRate}%
                          </p>
                          <p className="text-xs text-slate-400">7-day compliance</p>
                        </>
                      ) : (
                        <p className="text-xs text-slate-400">No tasks assigned</p>
                      )}
                    </div>
                  </div>
                </Card>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
