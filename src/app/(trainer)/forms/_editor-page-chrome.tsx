import { PageHeader } from '@/components/shared/page-header'

// Shared chrome for the form editor pages — a sticky PageHeader with
// "Back to forms" and the page title. Keeps each route file lean and
// consistent.
export function FormEditorPageChrome({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="p-4 md:p-8 w-full max-w-2xl mx-auto">
      <PageHeader
        title={title}
        back={{ href: '/settings?tab=forms', label: 'Back to forms' }}
      />
      {children}
    </div>
  )
}
