import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getTrainerContext } from '@/lib/membership'
import { loadTimesheetForExport, timesheetPdfFilename } from '@/lib/timesheet-data'
import { renderTimesheetPdf } from '@/lib/timesheet-pdf'
import { sendEmail, fromTrainer } from '@/lib/email'
import { money, minutesToHours } from '@/lib/timesheets'

export const runtime = 'nodejs'

const schema = z.object({ recipientEmail: z.string().email().optional() })

// Email the finalised timesheet PDF to the owner (or a chosen recipient).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await getTrainerContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid recipient email' }, { status: 400 })

  const loaded = await loadTimesheetForExport(id, ctx.companyId, ctx.userId)
  if (!loaded) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (loaded.status !== 'FINALISED') return NextResponse.json({ error: 'Finalise the timesheet before sending' }, { status: 409 })

  const recipient = parsed.data.recipientEmail || loaded.recipientEmail || loaded.ownerEmail
  if (!recipient) return NextResponse.json({ error: 'No recipient — enter an email address to send to' }, { status: 422 })

  const { data } = loaded
  const totalMinutes = data.entries.reduce((n, e) => n + e.minutes, 0)
  const totalCents = data.entries.reduce((n, e) => n + e.amountCents, 0)
  const weekEnd = new Date(data.weekStart); weekEnd.setUTCDate(weekEnd.getUTCDate() + 6)
  const weekLabel = new Date(data.weekStart).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

  let pdf: Buffer
  try {
    pdf = await renderTimesheetPdf(data)
  } catch (err) {
    console.error('[timesheet pdf]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Failed to generate the PDF' }, { status: 500 })
  }

  const subject = `Timesheet — ${data.staffName} — week of ${weekLabel}`
  const html = `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px"><tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(15,31,36,0.06)">
        <tr><td style="height:4px;background:#0d9488"></td></tr>
        <tr><td style="padding:22px 24px 24px">
          <p style="margin:0 0 14px;font-weight:700;color:#0d9488;font-size:15px">${data.businessName}</p>
          <h1 style="margin:0 0 8px;font-size:18px;color:#0f172a">Timesheet from ${data.staffName}</h1>
          <p style="margin:0 0 14px;font-size:14px;color:#475569">Week of ${weekLabel}${data.title ? ` · ${data.title}` : ''}. The full timesheet is attached as a PDF.</p>
          <table role="presentation" width="100%" style="font-size:14px;color:#0f172a;border-collapse:collapse">
            <tr><td style="padding:6px 0;color:#475569">Total hours</td><td style="padding:6px 0;text-align:right;font-weight:600">${minutesToHours(totalMinutes).toFixed(2)}h</td></tr>
            <tr><td style="padding:6px 0;color:#475569;border-top:1px solid #e2e8f0">Total amount</td><td style="padding:6px 0;text-align:right;font-weight:700;border-top:1px solid #e2e8f0">${money(totalCents, data.currency)}</td></tr>
          </table>
        </td></tr>
      </table>
      <p style="margin:14px 0 0;font-size:12px;color:#94a3b8">Sent with PupManager</p>
    </td></tr></table></body></html>`

  try {
    await sendEmail({
      to: recipient,
      subject,
      from: fromTrainer(data.businessName),
      text: `Timesheet from ${data.staffName} — week of ${weekLabel}.\nTotal: ${minutesToHours(totalMinutes).toFixed(2)}h · ${money(totalCents, data.currency)}.\nThe full timesheet is attached as a PDF.`,
      html,
      attachments: [{ filename: timesheetPdfFilename(data.weekStart), content: pdf }],
    })
  } catch (err) {
    console.error('[timesheet send]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Email failed to send' }, { status: 502 })
  }

  await prisma.timesheet.update({ where: { id }, data: { sentAt: new Date(), recipientEmail: recipient } })
  return NextResponse.json({ ok: true, sentTo: recipient })
}
