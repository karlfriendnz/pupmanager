'use client'

import Link from 'next/link'
import { ArrowLeft, Eye } from 'lucide-react'
import { AppShell } from '@/components/shared/app-shell'
import { ClientHomeView } from '@/app/(client)/home/home-view'

// Renders the real client home view with hardcoded sample data. Used when the
// trainer has no clients yet — gives them a faithful preview of what's
// coming once they invite their first client.
//
// Sample cast (per project_pup_cast.md): Sarah Carter + dog Bailey.

const SAMPLE_DOG = {
  id: 'demo-dog',
  name: 'Bailey',
  breed: 'Border Collie',
  photoUrl: null,
}

const SAMPLE_CLIENT_NAME = 'Sarah'

interface AchievementShape {
  id: string
  name: string
  icon: string | null
  color: string | null
}

export function DemoClientPreview({
  businessName,
  logoUrl,
  dashboardBgUrl,
  achievements,
}: {
  businessName: string
  logoUrl: string | null
  dashboardBgUrl: string | null
  achievements: AchievementShape[]
}) {
  // Tomorrow at 10am for the upcoming session.
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(10, 0, 0, 0)

  return (
    <div className="min-h-[100dvh] bg-slate-50 flex flex-col">
      <DemoBanner />
      <div className="flex-1">
        <AppShell
          role="CLIENT"
          userName={SAMPLE_CLIENT_NAME}
          userEmail="sarah@example.com"
          trainerLogo={logoUrl}
          businessName={businessName}
        >
          <ClientHomeView
            clientName={SAMPLE_CLIENT_NAME}
            businessName={businessName}
            dashboardBgUrl={dashboardBgUrl}
            trainerLogoUrl={logoUrl}
            primaryDog={SAMPLE_DOG}
            upcomingSession={{
              id: 'demo-session',
              title: 'Loose-leash walking · session 2',
              scheduledAt: tomorrow.toISOString(),
              durationMins: 60,
              location: 'Local park',
              sessionType: 'IN_PERSON',
            }}
            recentSessions={[
              { id: 'demo-rs1', title: 'Foundations · session 1', scheduledAt: addDaysISO(-7) },
            ]}
            homework={[
              { id: 'demo-h1', title: 'Five-minute name response practice', repetitions: 3, done: true },
              { id: 'demo-h2', title: '"Sit" with a 3-second hold', repetitions: 5, done: true },
              { id: 'demo-h3', title: 'Loose-leash walking — 100 metres', repetitions: 2, done: false },
            ]}
            latestMessage={{
              from: businessName,
              preview: "Great job with Bailey today! Try the homework when you have time this week.",
              createdAt: addDaysISO(-1),
              unread: true,
            }}
            packageProgress={{ label: 'Puppy Foundations', completed: 1, total: 6 }}
            featuredProducts={[]}
            libraryItems={[]}
            pendingRequests={[]}
            achievements={achievements.map(a => ({
              id: a.id,
              name: a.name,
              icon: a.icon,
              color: a.color,
              earned: false,
            }))}
          />
        </AppShell>
      </div>
    </div>
  )
}

function addDaysISO(offset: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return d.toISOString()
}

function DemoBanner() {
  return (
    <div className="sticky top-0 z-50 flex items-center justify-between gap-3 px-4 py-2 bg-gradient-to-r from-amber-50 via-amber-100 to-amber-50 border-b border-amber-200 text-amber-900 text-sm">
      <div className="flex items-center gap-2 min-w-0">
        <Eye className="h-4 w-4 shrink-0 text-amber-600" />
        <span className="font-medium truncate">
          Demo preview — this is what your clients will see once you invite one
        </span>
      </div>
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-white/70 hover:bg-white text-amber-800 text-xs font-medium transition-colors shrink-0"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Exit preview
      </Link>
    </div>
  )
}
