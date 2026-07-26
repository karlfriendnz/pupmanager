import { Eye, ArrowLeft } from 'lucide-react'
import { exitClientPreview } from '@/app/preview-as/actions'

// Class the client layout puts on the wrapper around {banner} + <AppShell>.
// The stylesheet below keys off it, so the offsets only ever apply in preview.
export const PREVIEW_SHELL_CLASS = 'pm-preview-shell'

// The banner's own height, stated once and used by both the bar and the
// offsets. The content row is pinned (h-11 = 2.75rem) rather than left to
// padding, so this is arithmetic rather than a guess: 44px row + 1px bottom
// border + whatever iOS reserves at the top.
const BANNER_HEIGHT = 'calc(2.75rem + 1px + env(safe-area-inset-top, 0px))'

// Fixed banner shown above the AppShell whenever a trainer is browsing the
// client app via preview cookie. The exit button is a server-action form so
// the cookie clears reliably without JS.
//
// It used to be `sticky top-0 z-50`, which looked right at rest and broke the
// moment anything scrolled: the shell's own mobile header is ALSO `sticky
// top-0` (z-30), so on scroll both parked at y=0 and the banner covered the
// header outright — trainer logo and account button gone and untappable. On
// desktop the shell's sidebar is `fixed inset-y-0`, so its logo sat under the
// banner even at rest, and page content scrolled under the bar.
//
// It is now genuinely fixed, and everything the shell pins to the top of the
// viewport is pushed down by exactly its height. Nothing is ever behind it.
export function PreviewBanner({ clientName }: { clientName: string }) {
  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: `
.${PREVIEW_SHELL_CLASS}{--pm-preview-banner:${BANNER_HEIGHT};padding-top:var(--pm-preview-banner)}
/* The shell root AND its content column both claim min-h-[100dvh]; shrink both
   or the page is a banner-height taller than the screen and a page that had no
   scroll at all grows one. */
.${PREVIEW_SHELL_CLASS}>div:last-child,
.${PREVIEW_SHELL_CLASS}>div:last-child>div{min-height:calc(100dvh - var(--pm-preview-banner))}
/* The two bits of shell chrome that pin themselves to the top of the viewport:
   the desktop sidebar (fixed inset-y-0) and the phone brand bar (sticky top-0).
   Scoped by structure so page content with its own <header>/<aside> is
   untouched — see app-shell.tsx ClientShell. */
.${PREVIEW_SHELL_CLASS}>div:last-child>aside,
.${PREVIEW_SHELL_CLASS}>div:last-child>div>header{top:var(--pm-preview-banner)}
`,
        }}
      />
      <div
        className="pm-preview-banner fixed inset-x-0 top-0 z-50 bg-amber-100 border-b border-amber-200 text-amber-900"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <div className="flex h-11 items-center justify-between gap-3 px-4 text-sm">
          <div className="flex items-center gap-2 min-w-0">
            <Eye className="h-4 w-4 shrink-0 text-amber-600" />
            <span className="font-medium truncate">
              Previewing as <span className="font-semibold">{clientName}</span>
            </span>
            <span className="hidden sm:inline text-xs text-amber-700/80">
              · what your client sees · actions are disabled
            </span>
          </div>
          <form action={async () => { 'use server'; await exitClientPreview() }}>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-white/70 hover:bg-white text-amber-800 text-xs font-medium transition-colors shrink-0"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Exit preview
            </button>
          </form>
        </div>
      </div>
    </>
  )
}
