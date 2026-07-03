import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getTrainerContext } from '@/lib/membership'
import { hasAddon } from '@/lib/billing'

// Lightweight lookup for the create forms: the trainer's curated Xero income
// account shortlist, straight from the DB (no live Xero API call). Returns an
// empty list when Xero isn't connected / the add-on is off / nothing's curated,
// so the account picker simply hides.
export async function GET() {
  const ctx = await getTrainerContext()
  if (!ctx) return NextResponse.json({ connected: false, accounts: [] })

  if (!(await hasAddon(ctx.companyId, 'xero'))) {
    return NextResponse.json({ connected: false, accounts: [] })
  }

  const conn = await prisma.xeroConnection.findUnique({
    where: { trainerId: ctx.companyId },
    select: { accountShortlist: true },
  })
  const accounts = (conn?.accountShortlist as { code: string; name: string }[] | null) ?? []
  return NextResponse.json({ connected: !!conn, accounts })
}
