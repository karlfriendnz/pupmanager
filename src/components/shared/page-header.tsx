import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'

type BackLink = { href: string; label?: string }

interface PageHeaderProps {
  title: string
  subtitle?: React.ReactNode
  back?: BackLink
  actions?: React.ReactNode
}

// Shared sticky page header used across the trainer app. Pins to the top
// of the viewport while the user scrolls and reserves
// env(safe-area-inset-top) so iOS chrome (time/battery) renders against
// the header's solid white surface — Style.Dark glyphs need a light
// background to stay legible.
//
// Layout contract:
// - Render as a SIBLING of the page's max-w content wrapper, not a child.
//   The header is full-width (spans the entire <main> content area) and
//   provides its own horizontal padding. Each page is:
//     <>
//       <PageHeader … />
//       <div className="p-4 md:p-8 w-full max-w-… mx-auto">…</div>
//     </>
export function PageHeader({ title, subtitle, back, actions }: PageHeaderProps) {
  return (
    <div
      className="sticky top-0 z-20 bg-white border-b border-slate-100 px-4 md:px-8"
      style={{
        // The header's own top padding combines safe-area-inset-top (so
        // iOS chrome sits on the white surface) with a small breathing
        // gap below it. <main> caps its own safe-area pad at 1rem; we
        // negate that with a transform so the bar's surface still extends
        // up under the chrome.
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.625rem)',
        paddingBottom: '0.625rem',
        // Pull the header up through <main>'s safe-area pad (capped 1rem)
        // so the bar's surface is flush with the very top of the viewport
        // on iOS. On desktop env() = 0 so this is a no-op.
        marginTop: 'calc(min(env(safe-area-inset-top, 0px), 1rem) * -1)',
      }}
    >
      <div className="flex items-center gap-2 min-w-0 min-h-12">
        {back && (
          <Link
            href={back.href}
            aria-label={back.label ?? 'Back'}
            className="-ml-1.5 flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 flex-shrink-0"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-semibold text-slate-900 truncate leading-tight">{title}</h1>
          {subtitle && (
            <div className="text-xs text-slate-500 truncate leading-tight mt-0.5">{subtitle}</div>
          )}
        </div>
        {actions && (
          <div className="flex items-center gap-1.5 flex-shrink-0">{actions}</div>
        )}
      </div>
    </div>
  )
}
