'use client'

import { useEffect, useState } from 'react'

/**
 * A readout of the numbers that decide phone layout, on the device itself.
 *
 * Why this exists: every layout bug Karl has reported from a real phone —
 * dead bands, a composer behind the keyboard, the whole window sliding — comes
 * down to safe-area insets, the visual viewport, and whether the page can
 * scroll. NONE of those exist in a desktop browser, so they can only be
 * reasoned about from here, and reasoning about them has been wrong every
 * time. Three deploys went out guessing at arithmetic this would have answered
 * in one screenshot.
 *
 * Open any screen with `?debug=viewport` and screenshot the panel. It reads
 * live, so it also shows what happens WHILE the keyboard is open.
 *
 * Gated on the query string rather than an env flag deliberately: the phone
 * that has the bug is running the production build, which is exactly where the
 * numbers are needed. It renders nothing at all without the parameter.
 */
export function ViewportDebug() {
  const [on, setOn] = useState(false)
  const [rows, setRows] = useState<[string, string][]>([])

  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('debug')) return
    if (new URLSearchParams(window.location.search).get('debug') !== 'viewport') return
    setOn(true)

    // env() is only readable through something that has applied it.
    const probe = document.createElement('div')
    probe.style.cssText =
      'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;' +
      'padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px);' +
      'padding-left:env(safe-area-inset-left,0px);padding-right:env(safe-area-inset-right,0px)'
    document.body.appendChild(probe)

    const px = (v: string) => `${Math.round(parseFloat(v) || 0)}`

    const read = () => {
      const p = getComputedStyle(probe)
      const vv = window.visualViewport
      const doc = document.documentElement
      const scrollable = doc.scrollHeight - window.innerHeight
      // The pinned message pane, when there is one.
      const pinned = document.querySelector<HTMLElement>('[data-pinned="true"]')
      const pane = pinned?.getBoundingClientRect()

      setRows([
        ['screen', `${window.innerWidth} × ${window.innerHeight}`],
        ['visual vp', vv ? `${Math.round(vv.width)} × ${Math.round(vv.height)}  @top ${Math.round(vv.offsetTop)}` : 'n/a'],
        ['keyboard', vv ? `${Math.max(0, Math.round(window.innerHeight - vv.height))}px` : 'n/a'],
        ['safe top/bottom', `${px(p.paddingTop)} / ${px(p.paddingBottom)}`],
        ['safe left/right', `${px(p.paddingLeft)} / ${px(p.paddingRight)}`],
        ['native shell', document.documentElement.dataset.native === 'true' ? 'yes' : 'no'],
        ['page can scroll', scrollable > 0 ? `YES — by ${scrollable}px` : 'no'],
        ['scrolled to', `${Math.round(window.scrollY)}px`],
        ['body overflow', document.body.style.overflow || '(unset)'],
        ['body pad-bottom', px(getComputedStyle(document.body).paddingBottom)],
        ['pinned pane', pane ? `top ${Math.round(pane.top)} → ${Math.round(pane.bottom)} (h ${Math.round(pane.height)})` : 'none'],
      ])
    }

    read()
    const tick = setInterval(read, 250)
    window.visualViewport?.addEventListener('resize', read)
    window.visualViewport?.addEventListener('scroll', read)
    window.addEventListener('resize', read)
    window.addEventListener('scroll', read)

    return () => {
      clearInterval(tick)
      window.visualViewport?.removeEventListener('resize', read)
      window.visualViewport?.removeEventListener('scroll', read)
      window.removeEventListener('resize', read)
      window.removeEventListener('scroll', read)
      probe.remove()
    }
  }, [])

  if (!on) return null

  return (
    <div
      // Pinned to the TOP: the bottom of the screen is usually the thing under
      // investigation, and a panel sitting on it would hide the evidence.
      className="fixed left-2 right-2 top-2 z-[9999] rounded-lg bg-slate-900/92 px-3 py-2 font-mono text-[11px] leading-[1.5] text-white shadow-lg"
      style={{ marginTop: 'env(safe-area-inset-top, 0px)' }}
    >
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-3">
          <span className="text-slate-400">{k}</span>
          <span className="tabular-nums">{v}</span>
        </div>
      ))}
    </div>
  )
}
