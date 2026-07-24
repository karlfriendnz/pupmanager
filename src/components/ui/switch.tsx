'use client'

// A proper pill on/off switch. NOTE: globals.css forces every <button> to a
// 44×44 minimum touch target — which turns a small rounded toggle into a circle.
// The inline minWidth/minHeight:0 overrides that (inline styles beat the
// stylesheet), so this always renders as a pill. Use this everywhere instead of
// hand-rolling a `relative w-9 h-5 rounded-full` toggle.
export function Switch({
  checked,
  onChange,
  disabled,
  onColor = 'bg-blue-600',
  className = '',
  'aria-label': ariaLabel,
}: {
  checked: boolean
  onChange: () => void
  disabled?: boolean
  /** Tailwind bg-* class for the ON state (defaults to blue). */
  onColor?: string
  className?: string
  'aria-label'?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onChange}
      style={{ minWidth: 0, minHeight: 0 }}
      className={`inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${checked ? `justify-end ${onColor}` : 'justify-start bg-slate-300'} ${className}`}
    >
      <span className="h-5 w-5 rounded-full bg-white shadow-sm transition-transform" />
    </button>
  )
}
