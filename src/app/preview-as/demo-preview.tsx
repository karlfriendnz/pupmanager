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
  breed: 'Golden Retriever',
  photoUrl: '/sample-dog.jpg',
}

const SAMPLE_CLIENT_NAME = 'Sarah'

// Fake badges so the demo's achievements section looks alive even before the
// trainer has published any of their own.
const SAMPLE_BADGES = [
  { id: 'b1', name: 'First session', icon: '🐾', color: 'blue', earned: true },
  { id: 'b2', name: '5 sessions together', icon: '⭐', color: 'amber', earned: true },
  { id: 'b3', name: 'First homework done', icon: '📓', color: 'sky', earned: true },
  { id: 'b4', name: 'Perfect week', icon: '🏆', color: 'violet', earned: false },
  { id: 'b5', name: '1 month together', icon: '📅', color: 'emerald', earned: false },
]

interface AchievementShape {
  id: string
  name: string
  icon: string | null
  color: string | null
}

export function DemoClientPreview({
  businessName,
  logoUrl,
  achievements,
}: {
  businessName: string
  logoUrl: string | null
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
          previewExitHref="/dashboard"
        >
          <ClientHomeView
      timeZone="Pacific/Auckland"
            shopEnabled
            clientName={SAMPLE_CLIENT_NAME}
            businessName={businessName}
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
              { id: 'demo-rs1', title: 'Recall & focus · session 3', scheduledAt: addDaysISO(-4) },
              { id: 'demo-rs2', title: 'Loose-leash walking · session 2', scheduledAt: addDaysISO(-11) },
              { id: 'demo-rs3', title: 'Foundations · session 1', scheduledAt: addDaysISO(-18) },
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
            packageProgress={{ label: 'Puppy Foundations', completed: 3, total: 6 }}
            featuredProducts={[
              { id: 'demo-p1', name: 'Long line — 10m', priceCents: 2400, imageUrl: '/concept-products/leash.jpg', kind: 'PHYSICAL' },
              { id: 'demo-p2', name: 'High-value treat pouch', priceCents: 1900, imageUrl: '/concept-products/treats.jpg', kind: 'PHYSICAL' },
              { id: 'demo-p3', name: 'Puppy starter kit', priceCents: 4900, imageUrl: '/concept-products/puppykit.jpg', kind: 'PHYSICAL' },
            ]}
            libraryItems={[]}
            pendingRequests={[]}
            achievements={achievements.length
              ? achievements.map(a => ({ id: a.id, name: a.name, icon: a.icon, color: a.color, earned: true }))
              : SAMPLE_BADGES}
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
    <div className="top-banner-safe sticky top-0 z-50 flex items-center justify-between gap-3 px-4 bg-gradient-to-r from-amber-50 via-amber-100 to-amber-50 border-b border-amber-200 text-amber-900 text-sm">
      <div className="flex items-center gap-2 min-w-0">
        <Eye className="h-4 w-4 shrink-0 text-amber-600" />
        <span className="font-medium truncate">
          Demo preview — this is what your clients will see once you invite one
        </span>
      </div>
      <Link
        href="/dashboard"
        className="relative inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold shadow-sm transition-colors shrink-0"
      >
        {/* Pinging dot to draw the eye to the way out of the preview. */}
        <span aria-hidden className="absolute -right-1 -top-1 flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full rounded-full bg-amber-300 opacity-75 motion-safe:animate-ping" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-400" />
        </span>
        <ArrowLeft className="h-3.5 w-3.5" />
        Exit preview
      </Link>
    </div>
  )
}
