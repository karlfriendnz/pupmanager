'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronRight, FolderTree } from 'lucide-react'
import { cn } from '@/lib/utils'
import { FlatBlock } from '@/components/shared/flat-list'
import type { TreeType } from './library-data'

// The Library's navigation spine: every category and the items inside it, in
// one expandable tree.
//
// Why one component for both viewports (see AGENTS.md "One layout per
// component"): the tree renders EXACTLY the same at 390px and 1440px. What
// changes is where it is mounted, which is the container's job —
//
//   • phone  → the tree IS the index page (/templates). A fixed left rail is a
//     desktop idea, and a drawer would be an overlay we'd have to scroll-lock
//     for something the trainer needs open while they work. Making the tree the
//     mobile index also replaces the old three-level drill-down (types →
//     themes → tasks) with one screen you can open as deep as you like.
//   • desktop → the same tree sits in a sticky left column beside the detail
//     pane. The column has NO overflow of its own — it grows with its content
//     and the PAGE scrolls, so there is never a second scrollbar on screen.
//
// Rows navigate; the chevron on the left expands. Both are full-height targets.

interface Props {
  tree: TreeType[]
  activeTypeId?: string
  activeThemeId?: string
  activeItemId?: string
  /** Visibility is the container's call — e.g. "md:hidden" on the index page. */
  className?: string
}

export function LibraryTree({ tree, activeTypeId, activeThemeId, activeItemId, className }: Props) {
  // The path to whatever is open starts expanded; everything else is closed.
  const activeType = activeTypeId
    ?? tree.find(t => t.themes.some(th =>
      th.id === activeThemeId || th.items.some(i => i.id === activeItemId)))?.id
  const activeTheme = activeThemeId
    ?? tree.flatMap(t => t.themes).find(th => th.items.some(i => i.id === activeItemId))?.id

  const [openTypes, setOpenTypes] = useState<Set<string>>(
    () => new Set(activeType ? [activeType] : []),
  )
  const [openThemes, setOpenThemes] = useState<Set<string>>(
    () => new Set(activeTheme ? [activeTheme] : []),
  )

  function toggle(set: Set<string>, id: string, apply: (s: Set<string>) => void) {
    const next = new Set(set)
    if (next.has(id)) next.delete(id); else next.add(id)
    apply(next)
  }

  if (tree.length === 0) {
    return (
      <div className={className}>
        <FlatBlock>
          <div className="px-4 py-10 text-center">
            <FolderTree className="mx-auto h-8 w-8 text-slate-300" strokeWidth={1.75} />
            <p className="mt-3 text-sm font-medium text-slate-900">Your library is empty</p>
            <p className="mt-1 text-[13px] text-slate-500">
              Start with a category like &ldquo;Obedience&rdquo;, then add themes and items inside it.
            </p>
          </div>
        </FlatBlock>
      </div>
    )
  }

  // Flattened so FlatBlock's hairline rule (direct children) draws every divider.
  const rows: React.ReactNode[] = []

  for (const type of tree) {
    const typeOpen = openTypes.has(type.id)
    const itemCount = type.themes.reduce((n, th) => n + th.items.length, 0)
    rows.push(
      <TreeRow
        key={type.id}
        depth={0}
        label={type.name}
        sub={`${type.themes.length} theme${type.themes.length === 1 ? '' : 's'} · ${itemCount} item${itemCount === 1 ? '' : 's'}`}
        href={`/templates/type/${type.id}`}
        active={activeTypeId === type.id}
        expandable
        expanded={typeOpen}
        onToggle={() => toggle(openTypes, type.id, setOpenTypes)}
      />,
    )
    if (!typeOpen) continue

    if (type.themes.length === 0) {
      rows.push(<EmptyRow key={`${type.id}-empty`} depth={1} text="No themes yet" />)
    }

    for (const theme of type.themes) {
      const themeOpen = openThemes.has(theme.id)
      rows.push(
        <TreeRow
          key={theme.id}
          depth={1}
          label={theme.name}
          sub={`${theme.items.length} item${theme.items.length === 1 ? '' : 's'}`}
          href={`/templates/theme/${theme.id}`}
          active={activeThemeId === theme.id}
          expandable
          expanded={themeOpen}
          onToggle={() => toggle(openThemes, theme.id, setOpenThemes)}
        />,
      )
      if (!themeOpen) continue

      if (theme.items.length === 0) {
        rows.push(<EmptyRow key={`${theme.id}-empty`} depth={2} text="No items yet" />)
      }
      for (const item of theme.items) {
        rows.push(
          <TreeRow
            key={item.id}
            depth={2}
            label={item.title}
            href={`/templates/item/${item.id}`}
            active={activeItemId === item.id}
          />,
        )
      }
    }
  }

  return (
    <div className={className}>
      <FlatBlock>{rows}</FlatBlock>
    </div>
  )
}

const INDENT = ['pl-2', 'pl-8', 'pl-14'] as const

function TreeRow({
  depth, label, sub, href, active, expandable, expanded, onToggle,
}: {
  depth: 0 | 1 | 2
  label: string
  sub?: string
  href: string
  active?: boolean
  expandable?: boolean
  expanded?: boolean
  onToggle?: () => void
}) {
  return (
    <div className={cn('flex items-stretch', active && 'bg-slate-50', INDENT[depth])}>
      {expandable ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={expanded ? `Collapse ${label}` : `Expand ${label}`}
          className="grid w-9 flex-shrink-0 place-items-center text-slate-400 active:bg-slate-100"
        >
          <ChevronRight
            className={cn('h-4 w-4 transition-transform', expanded && 'rotate-90')}
            strokeWidth={1.75}
          />
        </button>
      ) : (
        <span className="w-9 flex-shrink-0" aria-hidden />
      )}
      <Link
        href={href}
        className="min-w-0 flex-1 py-3 pr-4 text-left active:bg-slate-50"
      >
        <span className={cn(
          'block truncate',
          depth === 0 ? 'text-sm font-semibold text-slate-900'
            : depth === 1 ? 'text-sm font-medium text-slate-900'
            : 'text-sm text-slate-700',
          active && 'text-blue-700',
        )}>
          {label}
        </span>
        {sub && <span className="mt-0.5 block truncate text-[13px] text-slate-500">{sub}</span>}
      </Link>
    </div>
  )
}

function EmptyRow({ depth, text }: { depth: 1 | 2; text: string }) {
  return (
    <div className={cn('py-2.5 pr-4 text-[13px] text-slate-400', INDENT[depth])}>
      <span className="pl-9">{text}</span>
    </div>
  )
}
