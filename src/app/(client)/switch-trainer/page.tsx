import { redirect } from 'next/navigation'
import { ChevronRight, Check } from 'lucide-react'
import { getActiveClient, getClientTrainerOptions } from '@/lib/client-context'
import { PageHeader } from '@/components/shared/page-header'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Switch trainer' }

export default async function SwitchTrainerPage() {
  const active = await getActiveClient()
  if (!active) redirect('/login')

  const options = await getClientTrainerOptions()

  return (
    <>
      <PageHeader title="Your trainers" subtitle="Choose whose training space to view" />
      <div className="px-4 pt-5 pb-10 max-w-3xl mx-auto w-full space-y-3">
        {options.map(o => {
          const isActive = o.id === active.clientId
          const accent = o.trainer.emailAccentColor ?? '#2a9da9'
          return (
            // Plain anchor — the target is a GET route that sets a cookie, so
            // we don't want Next to prefetch it (that would switch silently).
            <a key={o.id} href={`/switch-trainer/${o.id}`} className="rounded-3xl bg-white shadow-[0_2px_16px_rgba(15,31,36,0.05)] p-4 flex items-center gap-3.5">
              {o.trainer.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={o.trainer.logoUrl} alt="" className="h-12 w-12 rounded-2xl object-contain bg-slate-50 shrink-0" />
              ) : (
                <div className="h-12 w-12 rounded-2xl flex items-center justify-center text-white font-display font-extrabold text-xl shrink-0" style={{ backgroundColor: accent }}>{o.trainer.businessName[0]}</div>
              )}
              <div className="flex-1 min-w-0">
                <p className="font-display font-bold text-slate-900 leading-tight truncate">{o.trainer.businessName}</p>
                {isActive && <p className="text-xs text-emerald-600 font-semibold inline-flex items-center gap-1"><Check className="h-3 w-3" /> Currently viewing</p>}
              </div>
              <ChevronRight className="h-5 w-5 text-slate-300 shrink-0" />
            </a>
          )
        })}
      </div>
    </>
  )
}
