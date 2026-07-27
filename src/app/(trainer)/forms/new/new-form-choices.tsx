'use client'

import Link from 'next/link'
import { ChevronRight, ClipboardList, FileText } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { FlatBlock } from '@/components/shared/flat-list'

// Client component on purpose: the rows take a Lucide component as their icon,
// and a function can't cross the server → client boundary ("Only plain objects
// can be passed to Client Components").

// Two doors, not four. The split that matters to a trainer is WHO FILLS IT IN:
// a session form is theirs to fill in after a session; a client form is the
// client's — whether they meet it as a website enquiry or as intake after
// being invited, which is a switch inside the one editor rather than a
// separate kind of form.
//
// "Lead-capture form" used to be a third choice, creating a legacy EmbedForm.
// It is gone: a client form set to "Website enquiry" does the same job with
// question types, conditional logic and pages. Existing lead-capture forms are
// still listed and editable so live embeds can be maintained.
const CHOICES: { icon: LucideIcon; label: string; sub: string; href: string }[] = [
  {
    icon: ClipboardList,
    label: 'Client form',
    sub: 'Questions your clients answer — as a website enquiry form, or as intake when you invite them. Choose either, or both.',
    href: '/forms/client/new',
  },
  {
    icon: FileText,
    label: 'Session form',
    sub: "Your own questions, filled in after a session. The answers become the client's report.",
    href: '/forms/session/new',
  },
]

export function NewFormChoices() {
  return (
    <>
      <p className="mb-3 px-1 text-sm text-slate-500">Who fills this one in?</p>
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
