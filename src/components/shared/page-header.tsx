'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { pageTitleLabel } from '@/lib/nav-labels'
import { SetPageTitle, SetPageHasBack, useHasPageTitleShell, useNavLabelOverrides } from './page-title'
import { PageHeaderTopBarPortal } from './page-header-portal'

// Either a Link (href) or a click handler (onClick — e.g. router.back() so
// "back" returns to wherever the user actually came from).
type BackLink = { href?: string; label?: string; onClick?: () => void }

interface PageHeaderProps {
  title: string
  /**
   * A quiet second line inside the top bar — whose record this is, what kind of
   * thing this is. NOT a page description (see the note below): it identifies,
   * it doesn't explain. Rendered in the same band as the title, so it costs a
   * line rather than a strip.
   */
  subtitle?: string
  back?: BackLink
  actions?: React.ReactNode
  // Rendered on its own row under the top bar (trainer shell), e.g. a page's
  // primary "New …" button. This row used to hold a one-line description of
  // the page as well; that came out on 2026-08-02 (Karl) — see the note below.
  descriptionActions?: React.ReactNode
}

// Shared page header used across the trainer app.
//
// DESKTOP: the global top bar (TrainerShell) owns the title — this component
// feeds it the title (SetPageTitle) and portals any back arrow + actions INTO
// the bar (PageHeaderTopBarPortal). It renders NO in-page bar on desktop, so
// there's never a redundant/empty second row.
//
// MOBILE: there is no top bar, so the full in-page sticky header renders here
// (title + back + actions), reserving env(safe-area-inset-top) so iOS chrome
// sits on the header's white surface.
//
// There is deliberately NO page description. Every page used to carry a
// one-liner under its title, with a Settings switch to hide them; both are
// gone. If they ever come back, note what they cost last time: the tabs above
// a list overlapped the sentence below them, which is a whole class of
// geometry bug that simply cannot happen when there is no sentence.
//
// Layout contract: render as a SIBLING of the page's max-w content wrapper:
//   <>
//     <PageHeader … />
//     <div className="p-4 md:p-8 w-full max-w-… mx-auto">…</div>
//   </>
export function PageHeader({ title: rawTitle, subtitle, back, actions, descriptionActions }: PageHeaderProps) {
  // In the trainer shell the phone top bar renders the title + back itself, so
  // the in-page mobile header below would duplicate it — skip it there.
  const shellOwnsMobileHeader = useHasPageTitleShell()
  // A trainer who renames "Library" to "Resources" in their menu shouldn't then
  // land on a page headed "Library". Only substituted when this page IS that menu
  // destination and its title is exactly our word for it — a page headed with a
  // client's name is left alone. No renames (the usual case) means no change.
  const pathname = usePathname()
  const title = pageTitleLabel(pathname, rawTitle, useNavLabelOverrides())
  return (
    <>
      <SetPageTitle title={title} subtitle={subtitle} />
      {/* Tells the phone bar to drop its menu icon while this page shows a
          back arrow — it can't see the arrow itself, since it arrives by
          portal. */}
      <SetPageHasBack value={!!back} />
      <PageHeaderTopBarPortal back={back} actions={actions} />
      {/* A page's primary action, under the top bar. The row is right-aligned
          on its own now that there is no description sharing the line. */}
      {shellOwnsMobileHeader && descriptionActions && (
        <div className="flex justify-end px-4 pt-3 md:px-8 md:pt-5">{descriptionActions}</div>
      )}
      {/* Mobile-only in-page header — only when the shell's top bar doesn't
          already show the page title (i.e. the client shell). */}
      {!shellOwnsMobileHeader && (
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
            {subtitle && <p className="truncate text-xs leading-tight text-slate-500">{subtitle}</p>}
          </div>
          {actions && (
            <div className="flex items-center gap-1.5 flex-shrink-0">{actions}</div>
          )}
        </div>
      </div>
      )}
    </>
  )
}
