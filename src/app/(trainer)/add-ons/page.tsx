import { redirect } from 'next/navigation'

// The Add-ons surface moved into Settings as a tab. Keep this route as a
// redirect so old bookmarks land in the right place. The data loading + cards
// now live in ../settings/addons-tab.tsx (AddonsTab).
export default function AddonsPage() {
  redirect('/settings?tab=addons')
}
