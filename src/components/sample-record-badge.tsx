import { FlaskConical } from 'lucide-react'

// Inline marker shown on records created by the onboarding sample-data load
// (isSample = true). Tells the trainer this row is demo-only and invisible to
// everyone else, so they don't mistake it for a real client/session/etc. Pure
// presentational — render it conditionally on `isSample`.
//
//   {client.isSample && <SampleRecordBadge />}
//
// `size="sm"` is a compact variant for list rows; default suits page headers.
export function SampleRecordBadge({ className = '', size = 'md' }: { className?: string; size?: 'sm' | 'md' }) {
  const sm = size === 'sm'
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 font-medium text-amber-800 ${
        sm ? 'px-1.5 py-0.5 text-[11px]' : 'px-2 py-0.5 text-xs'
      } ${className}`}
      title="Sample data — only you can see this"
    >
      <FlaskConical className={sm ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
      {sm ? 'Sample' : 'Sample data — only you can see this'}
    </span>
  )
}
