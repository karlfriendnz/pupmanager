'use client'

import { useState } from 'react'
import { AddonNudge } from '@/components/shared/addon-nudge'
import { AddonPromoModal } from '@/components/shared/addon-promos'

// The schedule's Google Calendar nudge. Clicking its CTA opens the add-on promo
// modal (which carries the "Connect Google Calendar" button = enable + OAuth),
// rather than bouncing off to a settings page.
export function GoogleCalendarNudge({
  googleAddonOn,
  forceShow,
}: {
  googleAddonOn: boolean
  forceShow?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <AddonNudge
        id="schedule-google-calendar"
        title="Sync your Google Calendar"
        body="See your sessions in Google Calendar and get a heads-up before you double-book."
        ctaLabel={googleAddonOn ? 'Connect Google Calendar' : 'Set it up'}
        ctaHref="/add-ons"
        onCta={() => setOpen(true)}
        image={{ src: '/promo-timesheets-v1.jpg', objectPosition: 'center 40%', translateX: '28%' }}
        // eslint-disable-next-line @next/next/no-img-element
        icon={<img src="/logos/google-calendar.webp" alt="Google Calendar" className="h-6 w-6 object-contain" />}
        forceShow={forceShow}
      />
      {open && <AddonPromoModal addonId="googlecalendar" onClose={() => setOpen(false)} />}
    </>
  )
}
