'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ChevronRight, ExternalLink, Workflow } from 'lucide-react'

import { FlatBlock, SectionLabel } from '@/components/shared/flat-list'
import { AddOfferingButton } from '@/components/shared/offering-card'
import { FullScreenSheet } from '@/components/shared/full-screen-sheet'
import {
  flowTimelineHref,
  groupFlowsBySection,
  groupOwnerChoicesBySection,
  flowIndexHeadline,
  ownerKey,
  type FlowOwner,
  type FlowOwnerChoice,
  type IndexedFlow,
} from '@/lib/flow-index'

/**
 * Every automation, listed — and editable without leaving the list.
 *
 * ── The one rule this screen is built around ────────────────────────────────
 *
 * There is NO editor here. Opening a row mounts `CommsFlowEditor`, the same
 * component the class page, the package page, the event page, the memberships
 * list and the form builder all mount, with the same props. Two mount points,
 * one editor, one set of API routes. A second editing UI would be two places to
 * change a step and two places for the rules to drift — and the flow rules
 * (which kinds may block, which steps the engine will skip) are exactly the
 * sort that punish that.
 *
 * ── Expanded in place, not in an overlay ────────────────────────────────────
 *
 * The editor opens its OWN full-screen sheets for the actual editing — adding a
 * step, changing one, previewing it — and those already portal to <body>, lock
 * body scroll and carry `no-scrollbar`. Putting the whole editor inside a
 * second overlay would stack sheet on sheet: two scroll locks, two portals
 * fighting over z-index, and a real chance of the thing Karl has banned outright
 * — two scrollbars on screen. Expanding in place has none of that, and it keeps
 * the flow's own summary (with its Off and needs-setting-up flags) on screen
 * directly above the editor changing it.
 *
 * One at a time, so the page never mounts fifteen editors each firing three
 * fetches on arrival.
 *
 * ── Staying fresh ───────────────────────────────────────────────────────────
 *
 * "Off" and "needs setting up" are DERIVED on the server, so an edit made here
 * would leave them stale. The editor calls `onChanged` after every successful
 * write (from `api()`, the single place it writes anything), and this refreshes
 * the server tree — the row above the editor flips to Off as soon as the last
 * step is switched off, with no reload.
 *
 * ── Starting one, not just editing one ──────────────────────────────────────
 *
 * Karl: "why can't i do this from the automations page?" There is nothing to
 * CREATE — a flow is steps hanging off a class, a package, a membership or a
 * form, with no row of its own — so "New automation" is a picker of those, and
 * then the same editor. Nothing at all is written until the first step is
 * saved, which is why an owner with none yet cannot appear in the list above:
 * the server has nothing to list. It gets a placeholder block here until its
 * first step lands, and the refresh above then replaces it with the real row.
 */
export function AutomationsPanel({
  flows,
  choices,
}: {
  flows: IndexedFlow[]
  /** Everything a new flow could hang off — already permission-filtered. */
  choices: FlowOwnerChoice[]
}) {
  const router = useRouter()
  const [picking, setPicking] = useState(false)

  const sections = groupFlowsBySection(flows)

  // Picking an owner goes to that flow's own page, whether or not it has steps
  // yet — the page IS the editor, so a brand-new flow and an existing one are
  // the same screen. An owner that already has a flow does NOT get a second
  // one: a flow has no identity beyond what it hangs off, so it simply opens.
  function choose(owner: FlowOwner) {
    setPicking(false)
    router.push(flowTimelineHref(owner, '/settings?tab=automations'))
  }

  // The shared control, so this follows the same rule as every other list:
  // the circle in the corner on a phone, the labelled button on desktop. It
  // used to draw its own labelled button at both sizes, so on a phone you got
  // that AND the circle — which is what Karl was looking at.
  const newButton = <AddOfferingButton label="New automation" onClick={() => setPicking(true)} />

  return (
    <div className="max-w-3xl" data-review-scope="Tab: Automations">
      <div className="mb-5 flex items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          {flowIndexHeadline(flows)}
        </p>
        {newButton}
      </div>

      {sections.length === 0 ? (
        <FlatBlock>
          <div className="px-4 py-10 text-center">
            <Workflow className="mx-auto h-6 w-6 text-slate-400" strokeWidth={1.75} />
            <p className="mt-3 text-sm font-medium text-slate-900">Nothing runs on its own yet</p>
            <p className="mx-auto mt-1 max-w-sm text-[13px] text-slate-500">
              Reminders, forms and homework you set up on a class, a package or a form show up
              here — so you can see everything your business sends without opening each one.
            </p>
          </div>
        </FlatBlock>
      ) : (
        <div className="space-y-6">
          {sections.map(section => (
            <section key={section.kind}>
              <SectionLabel>{section.label}</SectionLabel>
              <FlatBlock>
                {section.flows.map(flow => {
                  const key = ownerKey(flow.owner)
                  return (
                    <FlowRow key={key} flow={flow} />
                  )
                })}
              </FlatBlock>
            </section>
          ))}
        </div>
      )}

      {picking && (
        <OwnerPicker choices={choices} onPick={choose} onClose={() => setPicking(false)} />
      )}
    </div>
  )
}

/**
 * What the new automation hangs off — the whole screen, because there are far
 * more than the ~3 choices a menu is for (AGENTS.md: full screens, not
 * dropdowns), and because the answer is a name out of a list only the trainer
 * knows.
 *
 * Grouped and named exactly as the list above is, from the same
 * FLOW_OWNER_SECTIONS — a trainer picking "Puppy Class 4" here has to be able
 * to find "Puppy Class 4" there afterwards.
 *
 * Owners that ALREADY have a flow stay in the list, marked. Filtering them out
 * would mean the one class a trainer is looking for is missing with no
 * explanation; marked, the row says why and still takes them to it.
 */
function OwnerPicker({
  choices,
  onPick,
  onClose,
}: {
  choices: FlowOwnerChoice[]
  onPick: (owner: FlowOwner) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const sections = groupOwnerChoicesBySection(
    needle ? choices.filter(c => c.owner.name.toLowerCase().includes(needle)) : choices,
  )

  return (
    <FullScreenSheet
      title="New automation"
      sub="What should it run on?"
      onClose={onClose}
      headerExtra={
        choices.length > 8 ? (
          <div className="flex-shrink-0 border-b border-slate-200 bg-white px-4 py-3">
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search"
              aria-label="Search what to automate"
              className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--pm-brand-600)]"
            />
          </div>
        ) : undefined
      }
    >
      {choices.length === 0 ? (
        <p className="px-1 py-8 text-center text-[13px] text-slate-500">
          There is nothing to automate yet. Set up a class, a 1:1 session, a package or a form
          first, and it will be waiting here.
        </p>
      ) : sections.length === 0 ? (
        <p className="px-1 py-8 text-center text-[13px] text-slate-500">Nothing matches “{query}”.</p>
      ) : (
        <div className="space-y-5">
          {sections.map(section => (
            <section key={section.kind}>
              <SectionLabel>{section.label}</SectionLabel>
              <FlatBlock>
                {section.choices.map(choice => (
                  <button
                    key={ownerKey(choice.owner)}
                    type="button"
                    onClick={() => onPick(choice.owner)}
                    className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-slate-50"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-slate-900">{choice.owner.name}</span>
                      {/* Said plainly, because picking it opens what is already
                          there rather than starting something new. */}
                      {choice.hasFlow && (
                        <span className="mt-0.5 block text-[13px] text-slate-500">
                          Already has one — opens it
                        </span>
                      )}
                    </span>
                    <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-300" strokeWidth={1.75} />
                  </button>
                ))}
              </FlatBlock>
            </section>
          ))}
        </div>
      )}
    </FullScreenSheet>
  )
}

function FlowRow({
  flow,
}: {
  flow: IndexedFlow
}) {
  return (
    <div>
      {/* No accordion (Karl, 2026-08-06). Expanding in place was the answer
          before the flow had a page of its own; now that it has one, opening it
          here meant editing in the narrower of the two places, with the rest of
          Settings still on screen — the distraction the full page exists to
          remove. The row goes straight there. */}
      <div className="flex items-start gap-2 px-4 py-3.5">
        <Link
          href={flowTimelineHref(flow.owner, '/settings?tab=automations')}
          className="min-w-0 flex-1 text-left"
        >
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium text-slate-900">{flow.owner.name}</span>
            {/* A flow with every step switched off looks identical to a working
                one from the offering page it was built on. This is the first
                thing the screen exists to say. */}
            {flow.off && (
              <span className="rounded border border-slate-200 px-1.5 py-px text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Off
              </span>
            )}
          </span>
          <span className="mt-0.5 block text-[13px] text-slate-500">
            {flow.steps} step{flow.steps === 1 ? '' : 's'}
            {flow.liveSteps < flow.steps && !flow.off && <> · {flow.steps - flow.liveSteps} switched off</>}
            {' · '}
            Tap to open
          </span>
        </Link>

        {/* Its own page, for everything about this class or form that isn't its
            flow. The editors there are untouched and still the same one. */}
        <Link
          href={flow.owner.href}
          aria-label={`Open ${flow.owner.name}`}
          className="-m-1 flex-shrink-0 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          <ExternalLink className="h-4 w-4" strokeWidth={1.75} />
        </Link>
        <ChevronRight className="mt-2 h-4 w-4 flex-shrink-0 text-slate-400" strokeWidth={1.75} aria-hidden />
      </div>

      {/* What it actually does, in the builder's own words — flowStepSummary,
          so this screen and the editor cannot phrase the same step two ways. */}
      <ul className="space-y-1 px-4 pb-3.5">
        {flow.rows.map(row => (
          <li key={row.stepId} className="flex items-start gap-2 text-[13px] leading-5">
            <span className={row.enabled ? 'text-slate-400' : 'text-slate-300'} aria-hidden>·</span>
            <span className="min-w-0 flex-1">
              <span className={row.enabled ? 'text-slate-700' : 'text-slate-400 line-through'}>{row.what}</span>
              <span className="text-slate-400"> — {row.line}</span>
              {/* The SAME call the engine makes before it does anything, so a
                  step it will silently skip is a step this page visibly flags.
                  Finding out from the absence of an email is the failure. */}
              {row.enabled && row.problem && (
                <span className="ml-1 inline-flex items-center gap-1 text-amber-700">
                  <AlertTriangle className="h-3.5 w-3.5" strokeWidth={1.75} />
                  {row.problem}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
