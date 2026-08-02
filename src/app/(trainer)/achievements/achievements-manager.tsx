'use client'

import Link from 'next/link'
import {
  AddOfferingButton, OfferingItems, OfferingListBar, useOfferingView,
} from '@/components/shared/offering-card'
import { Trophy, Plus, ChevronRight } from 'lucide-react'
import { AchievementBadge } from '@/components/shared/achievement-badge'
import { richTextToPlain } from '@/lib/rich-text'
import { cn } from '@/lib/utils'
import {
  COLOR_BY_KEY, DEFAULT_COLOR, triggerLine,
  type AchievementRecord, type Color,
} from './triggers'

/**
 * The achievements list. Tapping one opens its own page — the editor used to
 * be a modal with its own scrollbar over the page's, which is the "never two
 * scrollbars" rule and the "full screens, not dropdowns" rule at once.
 */
export function AchievementsManager({ initial }: { initial: AchievementRecord[] }) {
  const [view, setView] = useOfferingView('achievements')

  if (initial.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-12 text-center">
        <Trophy className="mx-auto h-8 w-8 text-slate-300" strokeWidth={1.75} />
        <p className="mt-3 text-sm font-medium text-slate-600">No achievements yet</p>
        <p className="mx-auto mt-1 max-w-xs text-xs text-slate-400">
          Create badges your clients can earn — first session, 30-day streak, off-leash recall,
          whatever fits your programme.
        </p>
        <Link
          href="/achievements/new"
          className="mt-5 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3.5 py-2 text-sm font-medium text-slate-700 active:bg-slate-50"
        >
          <Plus className="h-4 w-4" strokeWidth={1.75} /> Add achievement
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2.5">
      {/* Add beside the view toggle, the same bar every other list carries —
          it was on a row of its own, which said the same thing but said it in
          a place a trainer had to learn separately. */}
      <OfferingListBar
        view={view}
        onView={setView}
        action={<AddOfferingButton href="/achievements/new" label="Add achievement" />}
      />

      {view === 'grid' ? (
        // A badge is a picture, so a wall of them is genuinely a better way to
        // judge the set than a column of rows — which is the whole test for
        // whether a grid view earns its toggle.
        <OfferingItems view="grid">
          {initial.map(a => (
            <div key={a.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <AchievementRow achievement={a} />
            </div>
          ))}
        </OfferingItems>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white [&>*+*]:border-t [&>*+*]:border-slate-200">
          {initial.map(a => <AchievementRow key={a.id} achievement={a} />)}
        </div>
      )}
    </div>
  )
}

function AchievementRow({ achievement: a }: { achievement: AchievementRecord }) {
  const tone = COLOR_BY_KEY[(a.color as Color) ?? DEFAULT_COLOR] ?? COLOR_BY_KEY[DEFAULT_COLOR]
  const rule = triggerLine(a)

  // Hide the free-text description when it just echoes the rule — the seeded
  // badges set both to the same sentence, so the row printed it twice.
  const norm = (s: string) => s.toLowerCase().replace(/[.\s]+/g, ' ').trim()
  const plain = a.description ? richTextToPlain(a.description) : ''
  const showDesc = plain && norm(plain) !== norm(rule)

  return (
    <Link href={`/achievements/${a.id}`} className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-slate-50">
      <AchievementBadge
        imageUrl={a.imageUrl}
        icon={a.icon}
        name={a.name}
        className={a.imageUrl ? undefined : cn('rounded-xl', tone.bgChip)}
      />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium text-slate-900">{a.name}</span>
          {!a.published && (
            <span className="flex-shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
              Draft
            </span>
          )}
        </span>
        {showDesc && <span className="mt-0.5 block truncate text-[13px] text-slate-500">{plain}</span>}
        <span className="mt-0.5 block truncate text-[13px] text-slate-400">{rule}</span>
      </span>
      <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-400" />
    </Link>
  )
}
