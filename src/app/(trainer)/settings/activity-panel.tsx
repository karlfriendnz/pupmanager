import { prisma } from '@/lib/prisma'
import { listAuditLogs } from '@/lib/audit'
import { formatDate } from '@/lib/utils'
import type { AuditAction } from '@/generated/prisma'

// Read-only audit trail for the business, OWNER-gated by the caller (the
// Settings page only renders this for ctx.role === 'OWNER'). Surfaces the
// append-only AuditLog rows scoped to this company.
const LABEL: Record<AuditAction, string> = {
  USER_SIGNUP: 'Account created',
  USER_LOGIN: 'Signed in',
  USER_LOGIN_FAILED: 'Failed sign-in',
  PASSWORD_RESET_REQUESTED: 'Password reset requested',
  PASSWORD_RESET_COMPLETED: 'Password reset',
  EMAIL_CHANGED: 'Email changed',
  ROLE_CHANGED: 'Member role changed',
  PERMISSIONS_CHANGED: 'Member permissions changed',
  INVITE_CREATED: 'Invite sent',
  INVITE_ACCEPTED: 'Invite accepted',
  MEMBER_REMOVED: 'Member removed',
  BILLING_CHANGED: 'Billing change',
  PAYMENTS_TOGGLED: 'Payments toggled',
  DATA_EXPORTED: 'Data exported',
  ACCOUNT_DELETION_REQUESTED: 'Account deletion requested',
  ACCOUNT_DELETED: 'Account permanently deleted',
  ADMIN_ACTION: 'Admin action',
}

export async function ActivityPanel({ companyId }: { companyId: string }) {
  const logs = await listAuditLogs(companyId, 100)

  // Resolve actor display names in one query.
  const actorIds = [...new Set(logs.map(l => l.actorUserId).filter(Boolean) as string[])]
  const actors = actorIds.length
    ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, email: true } })
    : []
  const actorById = new Map(actors.map(a => [a.id, a.name || a.email || a.id]))

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">Activity log</p>
      <p className="text-sm text-slate-500 mb-4">Sensitive actions on your business — sign-ins, team changes, billing and account events.</p>

      {logs.length === 0 ? (
        <p className="text-sm text-slate-400">No activity recorded yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-slate-400">
                <th className="pb-2 pr-4 font-medium">When</th>
                <th className="pb-2 pr-4 font-medium">Action</th>
                <th className="pb-2 pr-4 font-medium">By</th>
                <th className="pb-2 font-medium">IP</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(l => (
                <tr key={l.id} className="border-t border-slate-100">
                  <td className="py-2.5 pr-4 text-slate-500 whitespace-nowrap">{formatDate(l.createdAt)}</td>
                  <td className="py-2.5 pr-4 text-slate-800">{LABEL[l.action] ?? l.action}</td>
                  <td className="py-2.5 pr-4 text-slate-600">{l.actorUserId ? actorById.get(l.actorUserId) ?? '—' : '—'}</td>
                  <td className="py-2.5 text-slate-400 tabular-nums">{l.ip ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
