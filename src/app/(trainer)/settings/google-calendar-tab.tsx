import { prisma } from '@/lib/prisma'
import { getTrainerContext } from '@/lib/membership'
import { GoogleCalendarConnectCta } from '@/components/shared/google-calendar-connect-cta'

// Settings → Calendar tab. Only rendered when the Google Calendar add-on is
// enabled (gated in page.tsx via hasAddon), mirroring the Xero tab.
//
// This exists because connecting had NO permanent home. The only two ways in
// were the add-on promo modal — which by definition disappears once you enable
// the add-on — and a link in the schedule toolbar marked `hidden sm:inline-flex`,
// so desktop only. A trainer who switched the add-on on from a phone was left
// with the feature enabled, nothing connected, and no button anywhere. Reported
// twice by the same customer: "turned it on but it didn't redirect me to connect
// it" and "Google Calendar integration has no set-up options".
//
// Per-STAFF-MEMBER, not per-company: the connection hangs off membershipId, so
// each person on the team connects their own calendar and sees their own state.
export async function GoogleCalendarTab() {
  const ctx = await getTrainerContext()
  const conn = ctx?.membershipId
    ? await prisma.googleCalendarConnection.findUnique({
        where: { membershipId: ctx.membershipId },
        select: { connectedAt: true },
      })
    : null

  return (
    <div className="w-full max-w-2xl">
      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 p-4">
          <h2 className="text-base font-semibold text-slate-900">Google Calendar</h2>
          <p className="mt-1 text-sm text-slate-500">
            Your sessions, classes and availability appear in your Google Calendar, and anything
            already in it shows on your schedule so you don&rsquo;t get booked over.
          </p>
        </div>

        <div className="p-4">
          {conn && (
            <p className="mb-3 text-sm text-slate-500">
              Connected since{' '}
              <span className="font-medium text-slate-900">
                {conn.connectedAt.toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' })}
              </span>
            </p>
          )}
          <GoogleCalendarConnectCta />
          <p className="mt-3 text-sm text-slate-500">
            This is your own calendar. Everyone on your team connects theirs separately.
          </p>
        </div>
      </div>
    </div>
  )
}
