'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { LogIn, ChevronRight } from 'lucide-react'
import { formatDate } from '@/lib/utils'

// A single trainer row. Deliberately light: it shows the at-a-glance fields and
// taps through to the trainer's full view, where every detail + action lives.
// The only inline shortcut is "log in as" (impersonate), which stops row
// propagation so it doesn't also open the detail.
type Trainer = {
  id: string
  name: string | null
  email: string
  businessName: string | null
  subscriptionPlanName: string | null
  subscriptionStatus: string | null
  trialEndsAt: Date | string | null
  gracePeriodUntil: Date | string | null
  isInternal: boolean
  clientCount: number
  deactivatedAt: Date | string | null
  createdAt: Date | string
}

export function TrainerRow({ trainer }: { trainer: Trainer }) {
  const router = useRouter()
  const href = `/admin/trainers/${trainer.id}`
  const isActive = !trainer.deactivatedAt

  const graceUntil = trainer.gracePeriodUntil ? new Date(trainer.gracePeriodUntil) : null
  const graceActive = !!graceUntil && graceUntil.getTime() > Date.now()

  return (
    <tr
      onClick={() => router.push(href)}
      className={`border-b border-slate-700/50 hover:bg-slate-700/30 cursor-pointer transition-colors ${isActive ? '' : 'opacity-60'}`}
    >
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          {/* A real link on the name keeps the row keyboard-reachable and
              deep-linkable; clicking it lands in the same place as the row. */}
          <Link
            href={href}
            onClick={e => e.stopPropagation()}
            className="font-medium text-white hover:underline"
          >
            {trainer.businessName?.trim() || trainer.name?.trim() || '—'}
          </Link>
          {trainer.isInternal && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-purple-900 text-purple-300">Ours</span>
          )}
          {!isActive && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-rose-950 text-rose-300 border border-rose-500/40">Inactive</span>
          )}
        </div>
        <div className="text-xs text-slate-500 mt-0.5">{trainer.name?.trim() || trainer.email}</div>
      </td>
      <td className="px-4 py-3">
        <span className={`text-xs px-2 py-0.5 rounded-full ${
          trainer.subscriptionStatus === 'ACTIVE' ? 'bg-green-900 text-green-300' :
          trainer.subscriptionStatus === 'TRIALING' ? 'bg-blue-900 text-blue-300' :
          'bg-slate-700 text-slate-400'
        }`}>
          {trainer.subscriptionStatus === 'TRIALING'
            ? 'Trial'
            : trainer.subscriptionStatus === 'ACTIVE'
              ? (trainer.subscriptionPlanName ?? 'Active')
              : (trainer.subscriptionStatus ?? 'No plan')}
        </span>
        {graceActive && (
          <span className="ml-1.5 text-xs px-2 py-0.5 rounded-full bg-amber-900 text-amber-300">Grace</span>
        )}
      </td>
      <td className="px-4 py-3 text-slate-300 tabular-nums">{trainer.clientCount}</td>
      <td className="px-4 py-3 text-slate-400 tabular-nums whitespace-nowrap">{formatDate(new Date(trainer.createdAt))}</td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1 text-slate-400">
          <a
            href={`/api/admin/impersonate/${trainer.id}`}
            onClick={e => e.stopPropagation()}
            className="p-1.5 rounded-lg hover:bg-slate-700 hover:text-green-400 transition-colors"
            title={`Log in as ${trainer.name ?? trainer.email}`}
          >
            <LogIn className="h-4 w-4" />
          </a>
          <ChevronRight className="h-4 w-4 shrink-0" />
        </div>
      </td>
    </tr>
  )
}
