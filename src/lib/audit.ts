import { prisma } from './prisma'
import type { AuditAction, Prisma } from '@/generated/prisma'

// Append-only audit trail for sensitive actions (schema: model AuditLog).
//
// WRITE: only through recordAudit() below — there is intentionally no update or
// delete helper, so the trail is append-only at the application layer. Never put
// secrets, tokens, reset links, OTPs, passwords, or full card data in `meta`.
//
// READ: only through listAuditLogs(), which REQUIRES the caller to have already
// authorized access to `companyId` (OWNER of that company, or a platform ADMIN).
// Do not query prisma.auditLog directly from request handlers.

export type { AuditAction }

export interface AuditInput {
  action: AuditAction
  companyId?: string | null
  actorUserId?: string | null
  targetType?: string | null
  targetId?: string | null
  ip?: string | null
  userAgent?: string | null
  meta?: Prisma.InputJsonValue
}

/**
 * Record one audit event. Fire-and-forget: it never throws into the caller, so
 * a logging hiccup can't break the action being logged. Await it where you can,
 * but a floating call is acceptable for non-critical paths.
 */
export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: input.action,
        companyId: input.companyId ?? null,
        actorUserId: input.actorUserId ?? null,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        meta: input.meta,
      },
    })
  } catch (err) {
    console.error('[audit] failed to record', input.action, err instanceof Error ? err.message : err)
  }
}

/** Pull the request's IP + truncated user-agent for an audit record. */
export function auditRequestMeta(req: Request): { ip: string; userAgent: string } {
  const xff = req.headers.get('x-forwarded-for')
  const ip = (xff ? xff.split(',')[0] : req.headers.get('x-real-ip') ?? '').trim() || 'unknown'
  return { ip, userAgent: (req.headers.get('user-agent') ?? '').slice(0, 200) }
}

/**
 * Read a company's audit log. CALLER MUST have already confirmed the requester
 * is the company's OWNER or a platform ADMIN — this function does not re-check.
 */
export function listAuditLogs(companyId: string, limit = 100) {
  return prisma.auditLog.findMany({
    where: { companyId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 500),
  })
}
