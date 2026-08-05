import Link from 'next/link'
import { AlertTriangle, ChevronRight, Workflow } from 'lucide-react'

import { FlatBlock, SectionLabel } from '@/components/shared/flat-list'
import { groupFlowsBySection, flowIndexHeadline, type IndexedFlow } from '@/lib/flow-index'

/**
 * The read-only index of every automation.
 *
 * House style, and the three rules it kept breaking on the way here:
 *
 *   • ONE bordered block per section with hairline dividers — not a floating
 *     card per flow. A page of shadowed cards is the tell.
 *   • No tinted tile behind the icon, and no colour except the one amber word
 *     on a step the engine will skip. That word is the whole reason to look at
 *     this screen, so it is the only thing allowed to be loud.
 *   • A row is a LINK to the editor's existing home. Nothing here edits.
 *
 * A server component: it renders links and text, so it needs no interactivity
 * and should not ship any.
 */
export function AutomationsView({ flows }: { flows: IndexedFlow[] }) {
  const sections = groupFlowsBySection(flows)

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-10">
      <p className="mb-5 text-sm text-slate-500">{flowIndexHeadline(flows)}</p>

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
                {section.flows.map(flow => (
                  <FlowRow key={`${flow.owner.kind}:${flow.owner.id}`} flow={flow} />
                ))}
              </FlatBlock>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

function FlowRow({ flow }: { flow: IndexedFlow }) {
  return (
    <Link href={flow.owner.href} className="block px-4 py-3.5 active:bg-slate-50">
      <div className="flex items-start gap-3">
        <span className="min-w-0 flex-1">
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
          </span>
        </span>
        <ChevronRight className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-400" />
      </div>

      {/* What it actually does, in the builder's own words — flowStepSummary,
          so this screen and the editor cannot phrase the same step two ways. */}
      <ul className="mt-2 space-y-1">
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
    </Link>
  )
}
