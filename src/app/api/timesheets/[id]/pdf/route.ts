import { NextResponse } from 'next/server'
import { getTrainerContext } from '@/lib/membership'
import { loadTimesheetForExport, timesheetPdfFilename } from '@/lib/timesheet-data'
import { renderTimesheetPdf } from '@/lib/timesheet-pdf'

export const runtime = 'nodejs'

// Download the timesheet as a PDF (works for draft preview or finalised).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await getTrainerContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const loaded = await loadTimesheetForExport(id, ctx.companyId, ctx.userId)
  if (!loaded) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const pdf = await renderTimesheetPdf(loaded.data)
  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${timesheetPdfFilename(loaded.data.weekStart)}"`,
    },
  })
}
