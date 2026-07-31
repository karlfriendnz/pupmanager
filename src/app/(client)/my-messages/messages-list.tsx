import Link from 'next/link'
import { MessageCircle, Users } from 'lucide-react'
import { FlatBlock, SectionLabel } from '@/components/shared/flat-list'
import { cn } from '@/lib/utils'
import type { ClientThreadRow } from '@/lib/client-message-threads'

// The list a client lands on when they're in at least one group: their thread
// with the business, then every group that business put them in. One bordered
// block with hairlines — not a stack of cards — per AGENTS.md.

/**
 * Short enough to sit beside a name on a 390px screen: a time today, a weekday
 * this week, a date after that. Rendered on the server, so it can't drift
 * between markup and hydration the way a client-side "2 hours ago" does.
 */
function shortWhen(iso: string | null): string {
  if (!iso) return ''
  const then = new Date(iso)
  const days = (Date.now() - then.getTime()) / 86_400_000
  if (days < 1) return then.toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit' })
  if (days < 7) return then.toLocaleDateString('en-NZ', { weekday: 'short' })
  return then.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })
}

function Row({ row }: { row: ClientThreadRow }) {
  const href = row.kind === 'group' ? `/my-messages?group=${row.id}` : '/my-messages?thread=1'
  const Icon = row.kind === 'group' ? Users : MessageCircle
  const unread = row.unread > 0

  return (
    <Link href={href} className="flex items-start gap-3 px-4 py-3.5 active:bg-slate-50">
      <Icon className="mt-0.5 h-[18px] w-[18px] flex-shrink-0 text-slate-700" strokeWidth={1.75} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className={cn('min-w-0 truncate text-sm', unread ? 'font-bold text-slate-900' : 'font-medium text-slate-900')}>
            {row.name}
          </span>
          <span className={cn('flex-shrink-0 text-xs tabular-nums', unread ? 'font-semibold text-slate-700' : 'text-slate-400')}>
            {shortWhen(row.lastActivity)}
          </span>
        </span>
        <span className="mt-0.5 flex items-center gap-2">
          {/* An unaccepted invitation shows no preview at all — the whole point
              of the consent step is that the conversation stays closed until
              they say yes. */}
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-[13px]',
              row.pendingInvite ? 'font-medium text-slate-700' : unread ? 'text-slate-700' : 'text-slate-500',
            )}
          >
            {row.pendingInvite
              ? 'Invitation — tap to see what joining means'
              : row.preview ?? (row.archived ? 'Closed' : 'No messages yet')}
          </span>
          {unread && (
            <span
              data-testid="thread-unread"
              aria-label={`${row.unread} unread`}
              className="inline-flex h-5 min-w-5 flex-shrink-0 items-center justify-center rounded-full bg-rose-500 px-1.5 text-[10px] font-semibold tabular-nums text-white"
            >
              {row.unread > 9 ? '9+' : row.unread}
            </span>
          )}
        </span>
      </span>
    </Link>
  )
}

export function MessagesList({ rows }: { rows: ClientThreadRow[] }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-5 pb-10">
      <SectionLabel>Messages</SectionLabel>
      <FlatBlock>
        {rows.map(row => (
          <Row key={`${row.kind}:${row.id}`} row={row} />
        ))}
      </FlatBlock>
    </div>
  )
}
