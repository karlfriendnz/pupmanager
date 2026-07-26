'use client'

import Link from 'next/link'
import { ChevronRight, ClipboardList, FileText, Globe } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { FlatBlock } from '@/components/shared/flat-list'

// Client component on purpose: the rows take a Lucide component as their icon,
// and a function can't cross the server → client boundary ("Only plain objects
// can be passed to Client Components").

const CHOICES: { icon: LucideIcon; label: string; sub: string; href: string }[] = [
  {
    icon: FileText,
    label: 'Session form',
    sub: "Your own questions, filled in after a session. The answers become the client's report.",
    href: '/forms/session/new',
  },
  {
    icon: Globe,
    label: 'Lead-capture form',
    sub: 'A public form you embed on your own website — whoever fills it in lands in your enquiries.',
    href: '/forms/embed/new',
  },
  {
    icon: ClipboardList,
    label: 'Intake form',
    sub: 'You already have one, and there is only ever one. It asks every field in your library — add or remove those on the Fields tab.',
    href: '/settings?tab=forms&view=fields',
  },
]

export function NewFormChoices() {
  return (
    <>
      <p className="mb-3 px-1 text-sm text-slate-500">What do you need it to do?</p>
      <FlatBlock>
        {CHOICES.map(({ icon: Icon, label, sub, href }) => (
          <Link key={href} href={href} className="flex items-start gap-3 px-4 py-4 text-left active:bg-slate-50">
            <Icon className="mt-0.5 h-[18px] w-[18px] flex-shrink-0 text-slate-700" strokeWidth={1.75} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-slate-900">{label}</span>
              {/* Wraps, rather than truncating — each option gets room to
                  explain itself (AGENTS.md "Full screens, not dropdowns"). */}
              <span className="mt-1 block text-[13px] leading-snug text-slate-500">{sub}</span>
            </span>
            <ChevronRight className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-400" strokeWidth={1.75} />
          </Link>
        ))}
      </FlatBlock>
    </>
  )
}
