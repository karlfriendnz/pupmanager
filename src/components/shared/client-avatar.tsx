import { getInitials } from '@/lib/utils'

// One avatar for a client, shown everywhere a client is represented. Prefers the
// client's dog photo (the caller passes the PRIMARY dog's photoUrl, or the first
// dog's when there's no primary); falls back to the client's initials.
//
// `name` is the client's display name (used for initials + alt text). `dogPhotoUrl`
// is the resolved first/primary dog image (null when none set).
const SIZES = {
  xs: 'h-6 w-6 text-[9px]',
  sm: 'h-8 w-8 text-[11px]',
  md: 'h-9 w-9 text-xs',
  lg: 'h-11 w-11 text-sm',
} as const

export function ClientAvatar({
  name,
  dogPhotoUrl,
  size = 'md',
  className = '',
}: {
  name: string | null
  dogPhotoUrl?: string | null
  size?: keyof typeof SIZES
  className?: string
}) {
  const dim = SIZES[size]
  if (dogPhotoUrl) {
    return (
      <img
        src={dogPhotoUrl}
        alt={name ?? 'Client'}
        className={`${dim} flex-shrink-0 rounded-full object-cover bg-slate-100 ${className}`}
      />
    )
  }
  return (
    <span
      aria-hidden
      className={`${dim} flex flex-shrink-0 items-center justify-center rounded-full bg-blue-100 font-semibold text-blue-700 ${className}`}
    >
      {getInitials(name ?? '?')}
    </span>
  )
}
