import { redirect } from 'next/navigation'

// The trainers LIST merged into the admin dashboard — /admin is now the single
// screen carrying the platform totals, the recurring-revenue summary, the
// lifecycle tabs and the table. This route stays as a redirect because it's in
// bookmarks, in older emails/notes, and in the impersonation round-trip.
//
// Only the list moved: /admin/trainers/[trainerId] is a sibling route and is
// untouched by this redirect.
export default async function AdminTrainersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; tab?: string }>
}) {
  // Carry the tab/search through so a bookmarked "?tab=paying" lands where it
  // used to rather than dumping you on the default tab.
  const { q = '', tab = '' } = await searchParams
  const params = new URLSearchParams()
  if (tab) params.set('tab', tab)
  if (q) params.set('q', q)
  const query = params.toString()
  redirect(query ? `/admin?${query}` : '/admin')
}
