import { redirect } from 'next/navigation'

// The Website/Integration surface moved into Settings as a tab. Keep this route
// as a redirect so old bookmarks and internal router.push('/website') calls (the
// booking editor's back link, forms-manager) still land in the right place. The
// data loading now lives in ../settings/integration-tab.tsx (IntegrationTab).
export default function WebsitePage() {
  redirect('/settings?tab=integration')
}
