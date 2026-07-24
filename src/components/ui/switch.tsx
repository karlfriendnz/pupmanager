'use client'

// A proper on/off switch. Uses inline-flex + shrink-0 + a translated thumb so it
// can never collapse into a circle when it sits next to a label in a flex row
// (the failure mode of the old hand-rolled `relative w-9 h-5` toggles).
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
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${checked ? onColor : 'bg-slate-300'} ${className}`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-[1.125rem]' : 'translate-x-0.5'}`}
      />
    </button>
  )
}
