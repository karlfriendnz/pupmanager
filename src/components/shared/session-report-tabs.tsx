'use client'

import { useState } from 'react'

// Tabs for the client's session report — ON A PHONE ONLY.
//
// Karl asked for them, and the reason is length: on a 390px screen the write-up,
// the photos and the homework are three full screens stacked, so a client who
// wants to know what to practise scrolls past everything else to find it. Three
// taps beats three screens of thumb.
//
// Desktop keeps the sections STACKED. There is room to read them in order there,
// and the report's whole argument is the order — say what happened, show it,
// then what to practise. Tabs on a wide screen would hide two thirds of a
// document that fits.
//
// ── One DOM, two layouts ─────────────────────────────────────────────────────
//
// Every panel is rendered once and the inactive ones carry `hidden md:block`, so
// the phone shows one and the desktop shows all three. The alternative — render
// the tab bar on phones and a separate stack on desktop — duplicates the
// sections in the markup, and duplicated sections are how a component ends up
// with two layouts that drift (AGENTS.md: one layout per component; let the
// CONTAINER be responsive).
//
// ── No second scrollbar ──────────────────────────────────────────────────────
//
// The panel does NOT scroll. It is part of the page, so the page's scrollbar is
// the only one on screen — Karl's standing rule. Nothing here sets overflow, and
// nothing here should.
//
// The wrapper carries `data-review-scope` so a comment pinned in the review
// widget records WHICH tab it was made on. Without it every tab of this screen
// piles onto one indistinguishable page key.

export interface ReportTabSpec {
  id: string
  label: string
  node: React.ReactNode
}

export function SessionReportTabs({ tabs }: { tabs: ReportTabSpec[] }) {
  const [active, setActive] = useState(tabs[0]?.id ?? '')
  const current = tabs.find(t => t.id === active) ?? tabs[0]

  // One section with anything in it is not a set of tabs — it is a page. The
  // bar would be a single button that does nothing.
  if (tabs.length <= 1) {
    return <>{tabs.map(t => <div key={t.id}>{t.node}</div>)}</>
  }

  return (
    <div data-review-scope={`Tab: ${current?.label ?? ''}`}>
      {/* Hairline bar, no pills and no tinted chips — the house style. */}
      <div
        role="tablist"
        aria-label="Session report"
        className="md:hidden mb-4 flex items-stretch gap-1 border-b border-slate-200"
      >
        {tabs.map(t => {
          const on = t.id === current?.id
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={on}
              aria-controls={`report-panel-${t.id}`}
              onClick={() => setActive(t.id)}
              className={
                'flex-1 -mb-px border-b-2 px-1 pb-2.5 pt-1 text-sm transition-colors ' +
                (on
                  ? 'border-accent font-semibold text-slate-900'
                  : 'border-transparent font-medium text-slate-500')
              }
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {tabs.map(t => (
        <div
          key={t.id}
          id={`report-panel-${t.id}`}
          role="tabpanel"
          className={t.id === current?.id ? 'block' : 'hidden md:block'}
        >
          {t.node}
        </div>
      ))}
    </div>
  )
}
