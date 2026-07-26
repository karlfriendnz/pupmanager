import { cn } from '@/lib/utils'

/**
 * A badge, wherever it's drawn.
 *
 * A trainer can upload artwork for an achievement; when they haven't, the emoji
 * in `icon` stands in. One component so "image wins, emoji falls back" is
 * decided once — the trainer's list, the client's wall and the client profile
 * panel all used to hand-render `{a.icon || '🏆'}` and would each have needed
 * the same three lines.
 *
 * Server-safe (no hooks), so server components can render it directly.
 */
export function AchievementBadge({
  imageUrl,
  icon,
  name,
  size = 'md',
  dimmed = false,
  className,
}: {
  imageUrl?: string | null
  icon?: string | null
  name?: string
  /** sm = list row, md = card, lg = the client's wall. */
  size?: 'sm' | 'md' | 'lg'
  /** Not earned yet — greyed back, the same treatment the emoji had. */
  dimmed?: boolean
  className?: string
}) {
  const box = size === 'lg' ? 'h-14 w-14' : size === 'sm' ? 'h-9 w-9' : 'h-11 w-11'
  const text = size === 'lg' ? 'text-3xl' : size === 'sm' ? 'text-lg' : 'text-xl'

  if (imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- arbitrary blob host
      <img
        src={imageUrl}
        alt={name ?? ''}
        className={cn(
          box,
          'flex-shrink-0 rounded-xl border border-slate-200 object-cover',
          dimmed && 'opacity-30 grayscale',
          className
        )}
      />
    )
  }

  return (
    <span
      aria-hidden={!name}
      className={cn(
        box,
        text,
        'flex flex-shrink-0 items-center justify-center leading-none',
        dimmed && 'opacity-30 grayscale',
        className
      )}
    >
      {icon || '🏆'}
    </span>
  )
}
