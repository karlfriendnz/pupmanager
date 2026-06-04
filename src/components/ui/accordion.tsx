'use client'

import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Accordion({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-col gap-3', className)}>{children}</div>
}

export function AccordionItem({
  title,
  subtitle,
  defaultOpen = false,
  danger = false,
  children,
}: {
  title: string
  subtitle?: string
  defaultOpen?: boolean
  danger?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={cn('rounded-2xl border bg-white', danger ? 'border-red-100' : 'border-slate-200')}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
      >
        <span>
          <span className={cn('block text-sm font-semibold', danger ? 'text-red-700' : 'text-slate-900')}>
            {title}
          </span>
          {subtitle && <span className="mt-0.5 block text-xs text-slate-500">{subtitle}</span>}
        </span>
        <ChevronDown
          className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform', open && 'rotate-180')}
          aria-hidden
        />
      </button>
      {open && <div className="border-t border-slate-100 px-5 py-5">{children}</div>}
    </div>
  )
}
