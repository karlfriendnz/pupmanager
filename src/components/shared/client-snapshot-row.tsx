import Link from 'next/link'
import { MessageSquare } from 'lucide-react'
import { ClientAvatar } from '@/components/shared/client-avatar'

/**
 * One client in a "who's on this" snapshot (a package's Details tab, a class's
 * Details tab). The whole row opens their profile; the dog gets its own column
 * rather than sitting under the name; and the message icon goes straight to
 * that client's thread.
 *
 * The message link is a SIBLING of the row link, not a child — an anchor inside
 * an anchor is invalid HTML and swallows the inner click.
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
      <Link
        href={`/messages?client=${clientId}`}
        aria-label={`Message ${clientName}`}
        title={`Message ${clientName}`}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-blue-50 hover:text-blue-600"
      >
        <MessageSquare className="h-4 w-4" />
      </Link>
    </li>
  )
}
