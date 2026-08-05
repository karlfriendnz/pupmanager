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
      {/* `pm-centered` is not decoration. Above 1600px globals.css deliberately
          left-aligns page content (.pm-main > .mx-auto), so on a wide monitor
          this editor hugged the left edge with a lap of empty page beside it —
          which is exactly what that rule's own comment says a form must not do.
          This is the documented opt-in back to real centring. */}
      <div className="pm-centered mx-auto w-full max-w-5xl p-4 md:p-8">
        {children}
      </div>
    </>
  )
}
