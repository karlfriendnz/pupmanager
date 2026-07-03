import { NextResponse } from 'next/server'
import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { requireSameOrigin } from '@/lib/csrf'
import { revokeXeroConnections } from '@/lib/xero'

// Disconnect Xero. Owner-only + same-origin. We revoke the app on Xero's side
// (DELETE /connections/{id}) so it's removed from their "connected apps" list,
// then delete the local connection row (no row == not connected). The revoke is
// best-effort — if Xero is unreachable we still drop the local record.
export async function POST(req: Request) {
  const csrf = requireSameOrigin(req)
  if (csrf) return csrf

  // Xero is the business's company-wide accounting link. Gate on settings.edit
  // (owner/manager) to match the Settings → Xero tab — the UI hides it from
  // staff, and this route must enforce the same, not just role==='TRAINER'.
  // guardPermission re-validates membership, so a removed member is denied too.
  const guard = await guardPermission('settings.edit')
  if (guard instanceof NextResponse) return guard
  const trainerId = guard.companyId

  const connection = await prisma.xeroConnection.findUnique({
    where: { trainerId },
  })
  if (connection) {
    try {
      await revokeXeroConnections(connection)
    } catch (err) {
      console.error('[xero] revoke on disconnect failed', err)
    }
  }

  await prisma.xeroConnection.deleteMany({ where: { trainerId } })
  return NextResponse.json({ ok: true })
}
