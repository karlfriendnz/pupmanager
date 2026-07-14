import { redirect } from 'next/navigation'

// The intake form has no editor of its own any more — it IS the field library,
// which now lives on Settings → Fields & forms alongside the forms that use it.
// Kept as a redirect because onboarding links (and bookmarks) still point here.
export default function IntakeFormPage() {
  redirect('/settings?tab=forms')
}
