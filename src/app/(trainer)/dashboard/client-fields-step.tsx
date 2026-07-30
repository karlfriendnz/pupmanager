'use client'

/**
 * Onboarding: what you ask a new client.
 *
 * This step used to be a switchboard — nine built-in details, each with
 * "required" and "show on quick-add" toggles, saved to a per-company config. That
 * config is gone (Karl, 2026-07-30: "the system fields are just a result of the
 * forms"). What a client is asked for is the intake form's business now, so there
 * is nothing left here to configure.
 *
 * The step itself stays: it's a row in the prod-global onboarding catalogue, so
 * deleting the component would leave a step that renders nothing. It points at the
 * builder instead, which is where the answer now lives.
 */

import Link from 'next/link'
import { ClipboardList, ArrowRight } from 'lucide-react'
import { CLIENT_FIELDS } from '@/lib/client-fields'

export function ClientFieldsStep() {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-slate-600">
        You build one intake form and pick it when you invite someone. Whatever you
        put on it is what they’re asked — in the order you put it, and only the bits
        you mark as needed.
      </p>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Ready to drop in
        </p>
        {/* Named, so it's concrete: these are questions you pick, not fields you
            have to define first. */}
        <p className="mt-1.5 text-sm text-slate-600">
          {CLIENT_FIELDS.map(f => f.label).join(' · ')}
        </p>
        <p className="mt-2 text-sm text-slate-500">
          Plus anything of your own — a vet’s name, where they heard about you — and
          those answers save onto the client’s record too.
        </p>
      </div>

      <Link
        href="/forms/client/new?use=intake"
        className="inline-flex items-center gap-1.5 self-start text-sm font-semibold text-teal-700 hover:text-teal-900"
      >
        <ClipboardList className="h-4 w-4" strokeWidth={1.75} />
        Build your intake form
        <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
      </Link>

      <p className="text-xs text-slate-400">
        You can skip this and come back to it — nothing here blocks you.
      </p>
    </div>
  )
}
