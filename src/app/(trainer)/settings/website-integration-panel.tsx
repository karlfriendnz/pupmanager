import { ClientLoginLinkCard } from './client-login-link-card'
import { BookingPagesManager, type BookingPageRow } from './booking-pages-manager'

// "Website" tab — everything a trainer hooks into their own website: the
// branded client-login link and Calendly-style booking pages. (Lead-capture
// embed forms moved to Settings → Fields & forms.)
export function WebsiteIntegrationPanel({
  slug,
  appUrl,
  bookingPages,
}: {
  slug: string | null
  appUrl: string
  bookingPages: BookingPageRow[]
}) {
  return (
    <div className="flex flex-col gap-5">
      <ClientLoginLinkCard slug={slug} baseUrl={appUrl} />
      <BookingPagesManager initialPages={bookingPages} slug={slug} appUrl={appUrl} />
    </div>
  )
}
