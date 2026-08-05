'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ChevronDown, ExternalLink, Workflow } from 'lucide-react'

import { FlatBlock, SectionLabel } from '@/components/shared/flat-list'
import { CommsFlowEditor } from '@/components/trainer/comms-flow-editor'
import { cn } from '@/lib/utils'
import {
  flowEditorTarget,
  groupFlowsBySection,
  flowIndexHeadline,
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
 */
export function AutomationsPanel({ flows }: { flows: IndexedFlow[] }) {
  const router = useRouter()
  const [openKey, setOpenKey] = useState<string | null>(null)
  // `useTransition` so the refresh doesn't blank anything: the list keeps the
  // values it has until the new ones arrive, and the editor underneath is never
  // unmounted mid-edit.
  const [refreshing, startRefresh] = useTransition()

  const sections = groupFlowsBySection(flows)

  if (sections.length === 0) {
    return (
      <div className="max-w-3xl">
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
      </div>
    )
  }

  return (
    <div className="max-w-3xl" data-review-scope="Tab: Automations">
      <p className={cn('mb-5 text-sm text-slate-500 transition-opacity', refreshing && 'opacity-50')}>
        {flowIndexHeadline(flows)}
      </p>

      <div className="space-y-6">
        {sections.map(section => (
          <section key={section.kind}>
            <SectionLabel>{section.label}</SectionLabel>
            <FlatBlock>
              {section.flows.map(flow => {
                const key = `${flow.owner.kind}:${flow.owner.id}`
                return (
                  <FlowRow
                    key={key}
                    flow={flow}
                    open={openKey === key}
                    onToggle={() => setOpenKey(prev => (prev === key ? null : key))}
                    onChanged={() => startRefresh(() => router.refresh())}
                  />
                )
              })}
            </FlatBlock>
          </section>
        ))}
      </div>
    </div>
  )
}

function FlowRow({
  flow,
  open,
  onToggle,
  onChanged,
}: {
  flow: IndexedFlow
  open: boolean
  onToggle: () => void
  onChanged: () => void
}) {
  return (
    <div>
      {/* The whole summary is the button that opens the editor. The link out to
          the offering itself is a SIBLING, not a nested anchor — a link inside a
          button is invalid markup and the browser picks whichever it likes. */}
      <div className="flex items-start gap-2 px-4 py-3.5">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
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
            {open ? 'Tap to close' : 'Tap to edit'}
          </span>
        </button>

        {/* Its own page, for everything about this class or form that isn't its
            flow. The editors there are untouched and still the same one. */}
        <Link
          href={flow.owner.href}
          aria-label={`Open ${flow.owner.name}`}
          className="-m-1 flex-shrink-0 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          <ExternalLink className="h-4 w-4" strokeWidth={1.75} />
        </Link>
        <button
          type="button"
          onClick={onToggle}
          aria-hidden
          tabIndex={-1}
          className="-m-1 flex-shrink-0 rounded-lg p-2 text-slate-400"
        >
          <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} strokeWidth={1.75} />
        </button>
      </div>

      {/* What it actually does, in the builder's own words — flowStepSummary,
          so this screen and the editor cannot phrase the same step two ways.
          Hidden once the editor is open: the editor lists the same steps, and
          saying it twice is the "nothing says the same thing twice" rule. */}
      {!open && (
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
      )}

      {open && (
        <div className="border-t border-slate-200 bg-slate-50 px-4 py-4">
          {/* THE editor — the same component the offering pages mount, pointed
              at the same CRUD tree by the same id it uses there. */}
          <CommsFlowEditor
            {...flowEditorTarget(flow.owner)}
            offeringName={flow.owner.name}
            onChanged={onChanged}
          />
        </div>
      )}
    </div>
  )
}
