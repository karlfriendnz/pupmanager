import { prisma } from '@/lib/prisma'
import { AnnouncementsManager } from './announcements-manager'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Admin · Announcements' }

// Author platform "what's new" updates and broadcast them to every trainer's
// notification bell. Karl is the approval gate — nothing sends until he clicks.
export default async function AdminAnnouncementsPage() {
  const rows = await prisma.announcement.findMany({ orderBy: { createdAt: 'desc' } })
  const announcements = rows.map((a) => ({
    id: a.id,
    title: a.title,
    body: a.body,
    link: a.link,
    status: a.status,
    audience: a.audience,
    sentAt: a.sentAt ? a.sentAt.toISOString() : null,
    recipientCount: a.recipientCount,
    createdAt: a.createdAt.toISOString(),
  }))

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Announcements</h1>
        <p className="text-slate-400 text-sm mt-1">
          Tell trainers or clients when we improve the app. Write it in plain words, pick who gets it,
          check the preview, then send it to their notification bell. Nothing goes out until you press send.
        </p>
      </div>
      <AnnouncementsManager announcements={announcements} />
    </div>
  )
}
