'use client'

import Link from 'next/link'
import { ChevronRight, ClipboardList, FileText, Globe } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { FlatBlock } from '@/components/shared/flat-list'

// Client component on purpose: the rows take a Lucide component as their icon,
// and a function can't cross the server → client boundary ("Only plain objects
// can be passed to Client Components").

// Named by the JOB, not by our data model. "Client form" covered both intake and
// website enquiries, with the choice between them a switch inside the editor — so a
// trainer looking for an intake form couldn't see one here and had to know to open
// "Client form" and find the switch (Karl, 2026-07-30). Both are the same editor
// underneath; the link just arrives with the usage already set, and the switches
// are still there for anyone who wants one form to do both jobs.
//
// "Lead-capture form" used to be a choice here, creating a legacy EmbedForm. It is
// gone: a client form set to "Website enquiry" does the same job with question
// types, conditional logic and pages. Existing lead-capture forms are still listed
// and editable so live embeds can be maintained.
const CHOICES: { icon: LucideIcon; label: string; sub: string; href: string }[] = [
  {
    icon: ClipboardList,
    label: 'Intake form',
    sub: 'What a new client fills in before their first session. Pick it when you invite someone, and their answers land on their record.',
    href: '/forms/client/new?use=intake',
  },
  {
    icon: Globe,
    label: 'Website enquiry form',
    sub: 'For people who aren’t clients yet. Gets a public link you can share or embed, and submissions arrive in your enquiries.',
    href: '/forms/client/new?use=enquiry',
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
      <p className="mb-3 px-1 text-sm text-slate-500">What is this one for?</p>
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
