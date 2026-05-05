/**
 * Placeholder for an image the user will provide. Renders a labeled box at the
 * intended aspect ratio. Swap for <Image src=... /> when art is supplied.
 */
export function ImageSlot({
  label,
  aspect = '16/9',
  className = '',
}: {
  label: string
  aspect?: string
  className?: string
}) {
  return (
    <div
      className={`flex items-center justify-center rounded-2xl border border-dashed border-brand-300 bg-brand-50 text-center ${className}`}
      style={{ aspectRatio: aspect }}
    >
      <div className="px-6 text-sm text-brand-700">
        <p className="font-medium">Image slot</p>
        <p className="mt-1 text-brand-600">{label}</p>
      </div>
    </div>
  )
}
