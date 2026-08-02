import { PageHeader } from '@/components/shared/page-header'

// Shared chrome for the form editor pages — a sticky PageHeader with
// "Back to forms" and the page title. Keeps each route file lean and
// consistent.
export function FormEditorPageChrome({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <PageHeader
        title={title}
        back={{ href: '/settings?tab=forms', label: 'Back to forms' }}
      />
      {/* Wider than the old max-w-2xl: the builder puts a field palette beside
          the form from `lg` up, and 42rem left the form itself at about 26rem —
          narrower than a phone. The form column still tops out around 2xl on its
          own because the grid gives the rail a fixed 15rem. */}
      <div className="mx-auto w-full max-w-5xl p-4 md:p-8">
        {children}
      </div>
    </>
  )
}
