import { prisma } from '@/lib/prisma'
import { getTrainerContext } from '@/lib/membership'
import { isGoogleCalendarConfigured } from '@/lib/google-calendar'
import { GoogleCalendarConnectionCard } from './google-calendar-connection-card'

// Settings → Google Calendar tab. Only rendered when the (free) Google Calendar
// add-on is enabled (gated in page.tsx via hasAddon). Connections are PER MEMBER,
// so each signed-in staff member sees and controls only their OWN connection.
export async function GoogleCalendarTab() {
  const ctx = await getTrainerContext()
  const connection = ctx?.membershipId
    ? await prisma.googleCalendarConnection.findUnique({
        where: { membershipId: ctx.membershipId },
        select: { connectedAt: true },
      })
    : null

  return (
    <div className="w-full max-w-2xl">
      <GoogleCalendarConnectionCard
        connected={!!connection}
        configured={isGoogleCalendarConfigured()}
      />
    </div>
  )
}
