'use client'

import {
  EmailComposer,
  type EmailCandidate,
  type RecipientFacets,
  type ComposerBrand,
} from './email-composer'

// Re-exported from the shared composer so existing importers (marketing-view,
// unit tests) keep their `from './bulk-email-modal'` paths working.
export { summarizeBulkResult } from './email-composer'
export type { EmailCandidate, RecipientFacets, ComposerBrand } from './email-composer'

// Thin overlay wrapper: the Clients-list multi-select opens this modal, which
// just renders the shared <EmailComposer mode="modal"> inside a dialog shell.
export function BulkEmailModal({
  candidates,
  facets,
  initialSelectedIds,
  brand,
  onClose,
  onSent,
}: {
  candidates: EmailCandidate[]
  facets?: RecipientFacets
  initialSelectedIds?: string[]
  /** Trainer branding for the preview. Optional — minimal default when absent. */
  brand?: ComposerBrand
  onClose: () => void
  onSent: (summary: string) => void
}) {
  const resolvedBrand: ComposerBrand = brand ?? { businessName: '', logoUrl: null, accentColor: null }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Email clients"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <EmailComposer
        mode="modal"
        candidates={candidates}
        facets={facets}
        initialSelectedIds={initialSelectedIds}
        brand={resolvedBrand}
        onSent={onSent}
        onCancel={onClose}
      />
    </div>
  )
}
