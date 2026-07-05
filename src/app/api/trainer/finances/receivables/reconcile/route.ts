import { NextResponse } from 'next/server'
import { guardPermission } from '@/lib/membership'
import { reconcileTrainerXeroPayments } from '@/lib/invoicing'

// Manual "Check Xero for payments" action from Finances → Invoices. Pulls the
// latest payment state from Xero for every still-open synced invoice belonging
// to the trainer. billing.view-guarded + company-scoped via reconcileTrainer…
export async function POST() {
  const ctx = await guardPermission('billing.view')
  if (ctx instanceof NextResponse) return ctx

  const result = await reconcileTrainerXeroPayments(ctx.companyId)
  return NextResponse.json({ ok: true, ...result })
}
