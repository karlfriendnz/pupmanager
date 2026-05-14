export type FeatureIcon =
  | 'users'
  | 'calendar'
  | 'sync'
  | 'class'
  | 'template'
  | 'chart'
  | 'video'
  | 'phone'
  | 'message'
  | 'inbox'
  | 'trophy'
  | 'heart'
  | 'bell'
  | 'note'

/**
 * 24×24 line icons used across the site (pricing What's-included list,
 * the WhoItsFor accordions, etc). Heroicons-style outline, stroke-1.75,
 * no fill — colour controlled by the parent.
 */
export function FeatureGlyph({
  name,
  className = 'h-5 w-5',
}: {
  name: FeatureIcon
  className?: string
}) {
  const common = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    className,
  }
  switch (name) {
    case 'users':
      return (
        <svg {...common}>
          <path d="M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19" />
          <circle cx="10" cy="8" r="3.5" />
          <path d="M20 19v-1.5a3.5 3.5 0 0 0-2.5-3.36" />
          <path d="M16 5.5a3.5 3.5 0 0 1 0 6.5" />
        </svg>
      )
    case 'calendar':
      return (
        <svg {...common}>
          <rect x="3.5" y="5" width="17" height="15" rx="2" />
          <path d="M3.5 9.5h17" />
          <path d="M8 3.5v3M16 3.5v3" />
        </svg>
      )
    case 'sync':
      return (
        <svg {...common}>
          <path d="M4 8.5a8 8 0 0 1 14-3" />
          <path d="M18 4v4h-4" />
          <path d="M20 15.5a8 8 0 0 1-14 3" />
          <path d="M6 20v-4h4" />
        </svg>
      )
    case 'class':
      return (
        <svg {...common}>
          <circle cx="12" cy="7" r="3" />
          <path d="M5.5 18.5a6.5 6.5 0 0 1 13 0" />
          <circle cx="5" cy="9" r="2" />
          <circle cx="19" cy="9" r="2" />
        </svg>
      )
    case 'template':
      return (
        <svg {...common}>
          <rect x="4" y="3.5" width="16" height="17" rx="2" />
          <path d="M8 8h8M8 12h8M8 16h5" />
        </svg>
      )
    case 'chart':
      return (
        <svg {...common}>
          <path d="M4 20h16" />
          <rect x="6" y="13" width="3" height="6" rx="0.5" />
          <rect x="11" y="9" width="3" height="10" rx="0.5" />
          <rect x="16" y="5" width="3" height="14" rx="0.5" />
        </svg>
      )
    case 'video':
      return (
        <svg {...common}>
          <rect x="3" y="6" width="13" height="12" rx="2" />
          <path d="M16 10l5-3v10l-5-3z" />
        </svg>
      )
    case 'phone':
      return (
        <svg {...common}>
          <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
          <path d="M11 18.5h2" />
        </svg>
      )
    case 'message':
      return (
        <svg {...common}>
          <path d="M4 6.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-3l-3 3.5v-3.5H6a2 2 0 0 1-2-2z" />
          <path d="M8 9.5h8M8 12.5h5" />
        </svg>
      )
    case 'inbox':
      return (
        <svg {...common}>
          <path d="M3.5 13l2.5-7a2 2 0 0 1 1.9-1.4h8.2A2 2 0 0 1 18 6l2.5 7" />
          <path d="M3.5 13v5a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-5h-5l-2 2.5h-3l-2-2.5z" />
        </svg>
      )
    case 'trophy':
      return (
        <svg {...common}>
          <path d="M8 4h8v5a4 4 0 0 1-8 0V4z" />
          <path d="M5 5h3v3a3 3 0 0 1-3-3z" />
          <path d="M19 5h-3v3a3 3 0 0 0 3-3z" />
          <path d="M9 19h6" />
          <path d="M12 13v6" />
        </svg>
      )
    case 'heart':
      return (
        <svg {...common}>
          <path d="M12 20.5l-7.4-7.5a4.5 4.5 0 0 1 6.4-6.4l1 1 1-1a4.5 4.5 0 1 1 6.4 6.4z" />
        </svg>
      )
    case 'bell':
      return (
        <svg {...common}>
          <path d="M6 16v-4a6 6 0 0 1 12 0v4l1.5 2h-15z" />
          <path d="M10 20a2 2 0 0 0 4 0" />
        </svg>
      )
    case 'note':
      return (
        <svg {...common}>
          <path d="M14 3.5H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9.5" />
          <path d="M14 3.5v6h6" />
          <path d="M8 13h8M8 16h5" />
          <path d="M16.5 3.5l3.5 3.5" />
        </svg>
      )
  }
}
