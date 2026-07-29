import { redirect } from 'next/navigation'

// Email templates moved into Settings (2026-07-30) — it belongs beside the
// other business setup rather than as its own nav item. Kept as a redirect so
// existing links and bookmarks still land in the right place.
export default function EmailTemplatesPage() {
  redirect('/settings?tab=emails')
}
