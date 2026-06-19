import { ClientLoginLinkCard } from './client-login-link-card'
import { BookingPagesManager, type BookingPageRow } from './booking-pages-manager'
import { EmbedFormsCard, type EmbedFormRow } from './embed-forms-card'

// "Website" tab — everything a trainer hooks into their own website: the
// branded client-login link, Calendly-style booking pages, and lead-capture
// embed forms. Pulls these together from where they used to live scattered
// across Profile / Forms / Booking.
export function WebsiteIntegrationPanel({
  slug,
  appUrl,
  bookingPages,
  embedForms,
}: {
  slug: string | null
  appUrl: string
  bookingPages: BookingPageRow[]
  // null when the member can't manage forms — the embed-forms card is hidden.
  embedForms: EmbedFormRow[] | null
}) {
  return (
    <div className="flex flex-col gap-5">
      <ClientLoginLinkCard slug={slug} baseUrl={appUrl} />
      <BookingPagesManager initialPages={bookingPages} slug={slug} appUrl={appUrl} />
      {embedForms != null && <EmbedFormsCard forms={embedForms} />}
    </div>
  )
}
