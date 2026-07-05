import { NextResponse } from 'next/server'
import { guardPermission } from '@/lib/membership'
import { sendReceivable } from '@/lib/invoicing'

// Mark an unsent receivable as sent + notify the client. Guarded by
// billing.view (matching the invoice resend route); scoped to the company via
// sendReceivable's trainerId check.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await guardPermission('billing.view')
  if (ctx instanceof NextResponse) return ctx

  const { id } = await params
  const ok = await sendReceivable(id, ctx.companyId)
  if (!ok) return NextResponse.json({ error: 'Invoice not found or cannot be sent.' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
