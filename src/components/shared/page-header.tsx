import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { SetPageTitle } from './page-title'
import { PageHeaderTopBarPortal } from './page-header-portal'

// Either a Link (href) or a click handler (onClick — e.g. router.back() so
// "back" returns to wherever the user actually came from).
type BackLink = { href?: string; label?: string; onClick?: () => void }

interface PageHeaderProps {
  title: string
  subtitle?: React.ReactNode
  back?: BackLink
  actions?: React.ReactNode
}

// Shared page header used across the trainer app.
//
// DESKTOP: the global top bar (TrainerShell) owns the title — this component
// feeds it the title (SetPageTitle) and portals any back arrow + actions INTO
// the bar (PageHeaderTopBarPortal). It renders NO in-page bar on desktop, so
// there's never a redundant/empty second row.
//
// MOBILE: there is no top bar, so the full in-page sticky header renders here
// (title + back + subtitle + actions), reserving env(safe-area-inset-top) so
// iOS chrome sits on the header's white surface.
//
// Layout contract: render as a SIBLING of the page's max-w content wrapper:
//   <>
//     <PageHeader … />
//     <div className="p-4 md:p-8 w-full max-w-… mx-auto">…</div>
//   </>
export function PageHeader({ title, subtitle, back, actions }: PageHeaderProps) {
  return (
    <>
      <SetPageTitle title={title} />
      <PageHeaderTopBarPortal back={back} actions={actions} />
      {/* Mobile-only in-page header (no top bar on mobile). */}
      <div
        className="md:hidden sticky z-20 bg-white border-b border-slate-100 px-4"
        style={{
          top: 'var(--app-top-offset, 0px)',
          paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.625rem)',
          paddingBottom: '0.625rem',
          marginTop: 'calc(min(env(safe-area-inset-top, 0px), 1rem) * -1)',
        }}
      >
        <div className="flex items-center gap-2 min-w-0 min-h-12">
          {back && (
            back.onClick ? (
              <button
                type="button"
                onClick={back.onClick}
                aria-label={back.label ?? 'Back'}
                className="-ml-1.5 flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 flex-shrink-0"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            ) : (
              <Link
                href={back.href ?? '#'}
                aria-label={back.label ?? 'Back'}
                className="-ml-1.5 flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 flex-shrink-0"
              >
                <ArrowLeft className="h-4 w-4" />
              </Link>
            )
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
    </>
  )
}
