import Link from 'next/link'
import { ClientAvatar } from '@/components/shared/client-avatar'

/**
 * One client in a "who's on this" snapshot (a package's Details tab, a class's
 * Details tab). The whole row opens their profile, and the dog gets its own
 * column rather than sitting under the name.
 *
 * No message icon here: this is the quick "who's on this" glance, and the row
 * does one thing. Messaging a client lives on the full roster under the Clients
 * tab, which is the screen you go to when you're working through people.
 */
export function ClientSnapshotRow({
  clientId,
  clientName,
  dogName,
  dogPhotoUrl,
  badge,
}: {
  clientId: string
  clientName: string
  dogName?: string | null
  dogPhotoUrl?: string | null
  /** A short status word for this row — "Waitlist", say. */
  badge?: string | null
}) {
  return (
    <li className="group flex items-center gap-2 py-2">
      <Link
        href={`/clients/${clientId}`}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg transition-colors"
      >
        <ClientAvatar name={clientName} dogPhotoUrl={dogPhotoUrl} size="sm" />
        {/* Two columns: owner, then dog. Equal-ish widths so the dog column
            lines up down the list instead of ragging off the name length. */}
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900 group-hover:text-blue-600">
          {clientName}
        </span>
        <span className="min-w-0 w-[38%] shrink-0 truncate text-sm text-slate-500">{dogName || '—'}</span>
        {badge && <span className="shrink-0 text-[11px] text-amber-600">{badge}</span>}
      </Link>
    </li>
  )
}
