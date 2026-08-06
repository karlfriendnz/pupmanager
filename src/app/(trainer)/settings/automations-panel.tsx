'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ChevronDown, ChevronRight, ExternalLink, Maximize2, Plus, Workflow } from 'lucide-react'

import { FlatBlock, SectionLabel } from '@/components/shared/flat-list'
import { FullScreenSheet } from '@/components/shared/full-screen-sheet'
import { CommsFlowEditor } from '@/components/trainer/comms-flow-editor'
import { cn } from '@/lib/utils'
import {
  flowEditorTarget,
  flowSectionLabel,
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
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  // The owner chosen for a flow that does not exist yet. It has no row in
  // `flows` (the server has no steps to build one from), so the screen carries
  // it until the first step is saved.
  const [pending, setPending] = useState<FlowOwner | null>(null)
  // `useTransition` so the refresh doesn't blank anything: the list keeps the
  // values it has until the new ones arrive, and the editor underneath is never
  // unmounted mid-edit.
  const [refreshing, startRefresh] = useTransition()

  const sections = groupFlowsBySection(flows)
  const existing = useMemo(() => new Set(flows.map(f => ownerKey(f.owner))), [flows])

  // The moment the new flow's first step lands, the refreshed server tree has a
  // REAL row for it — carrying its Off and needs-setting-up flags, which the
  // placeholder cannot know. Hand over to it, and leave it open where the
  // trainer was working.
  useEffect(() => {
    if (pending && existing.has(ownerKey(pending))) {
      setOpenKey(ownerKey(pending))
      setPending(null)
    }
  }, [existing, pending])

  function choose(owner: FlowOwner) {
    setPicking(false)
    const key = ownerKey(owner)
    // An owner that already has a flow does NOT get a second one — a flow has no
    // identity beyond what it hangs off. Its existing row simply opens.
    if (existing.has(key)) {
      setPending(null)
      setOpenKey(key)
      return
    }
    setPending(owner)
    setOpenKey(key)
  }

  const onChanged = () => startRefresh(() => router.refresh())
  const newButton = (
    <button
      type="button"
      onClick={() => setPicking(true)}
      className="inline-flex h-10 flex-shrink-0 items-center gap-1.5 rounded-xl bg-[var(--pm-brand-600)] px-3.5 text-sm font-semibold text-white hover:bg-[var(--pm-brand-700)]"
    >
      <Plus className="h-4 w-4" strokeWidth={2} />
      New automation
    </button>
  )

  return (
    <div className="max-w-3xl" data-review-scope="Tab: Automations">
      <div className="mb-5 flex items-center justify-between gap-3">
        <p className={cn('text-sm text-slate-500 transition-opacity', refreshing && 'opacity-50')}>
          {flowIndexHeadline(flows)}
        </p>
        {newButton}
      </div>

      {sections.length === 0 && !pending ? (
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
          {/* The one being started, above the list: it is what the trainer just
              asked for, and it has nothing to say about itself yet. */}
          {pending && (
            <section>
              <SectionLabel>{flowSectionLabel(pending.kind)}</SectionLabel>
              <FlatBlock>
                <div className="px-4 py-3.5">
                  <p className="truncate text-sm font-medium text-slate-900">{pending.name}</p>
                  <p className="mt-0.5 text-[13px] text-slate-500">
                    Nothing in it yet — add the first step and it saves straight away.
                  </p>
                </div>
                <div className="border-t border-slate-200 bg-slate-50 px-4 py-4">
                  {/* THE editor again, pointed at this owner by the same map the
                      rows use. No second "add step" anything. */}
                  <CommsFlowEditor
                    {...flowEditorTarget(pending)}
                    offeringName={pending.name}
                    onChanged={onChanged}
                  />
                </div>
              </FlatBlock>
            </section>
          )}

          {sections.map(section => (
            <section key={section.kind}>
              <SectionLabel>{section.label}</SectionLabel>
              <FlatBlock>
                {section.flows.map(flow => {
                  const key = ownerKey(flow.owner)
                  return (
                    <FlowRow
                      key={key}
                      flow={flow}
                      open={openKey === key}
                      onToggle={() => setOpenKey(prev => (prev === key ? null : key))}
                      onChanged={onChanged}
                    />
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

        {/* The flow on its own page — the same editor, with nothing else on the
            screen (Karl: "to remove distraction"). One tap from the list, not
            two: expanding first to reach the link inside would make the
            distraction-free view the more buried of the two. */}
        <Link
          href={flowTimelineHref(flow.owner, '/settings?tab=automations')}
          aria-label={`Open ${flow.owner.name} full screen`}
          className="-m-1 flex-shrink-0 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          <Maximize2 className="h-4 w-4" strokeWidth={1.75} />
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
