import { NextResponse } from 'next/server'
import { z } from 'zod'
import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { resendClient, sendEmail, fromTrainer } from '@/lib/email'
import { escapeHtml } from '@/lib/enquiries'

// Email the trainer's DNS records to whoever manages their domain (a developer /
// IT person / web host). Most trainers won't edit DNS themselves, so this lets
// them forward the exact records. Sent from the platform sender with the
// trainer as Reply-To, so the developer can reply straight back to them.
type ResendRecord = { record?: string; name?: string; type?: string; ttl?: string; value?: string; priority?: string }

const schema = z.object({ email: z.string().email() })

export async function POST(req: Request) {
  const guard = await guardPermission('settings.edit')
  if (guard instanceof NextResponse) return guard

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 })

  const trainer = await prisma.trainerProfile.findUnique({
    where: { id: guard.companyId },
    select: { businessName: true, sendingDomain: true, resendDomainId: true, user: { select: { name: true, email: true } } },
  })
  if (!trainer?.resendDomainId || !trainer.sendingDomain) {
    return NextResponse.json({ error: 'Set up your sending domain first', code: 'NO_DOMAIN' }, { status: 400 })
  }

  // Pull the live records from Resend so the email always reflects current state.
  const res = await resendClient().domains.get(trainer.resendDomainId)
  const records = ((res.data as { records?: ResendRecord[] } | null)?.records ?? [])
  if (records.length === 0) {
    return NextResponse.json({ error: 'No DNS records to share yet', code: 'NO_RECORDS' }, { status: 422 })
  }

  const displayName = trainer.user.name?.trim() || trainer.businessName
  const safeDomain = escapeHtml(trainer.sendingDomain)
  const safeBusiness = escapeHtml(trainer.businessName)
  const safeName = escapeHtml(displayName)

  const rows = records.map(r => {
    const cells = [r.type ?? '', r.name ?? '', r.value ?? '', r.priority ?? '', r.ttl ?? 'Auto']
    return `<tr>${cells
      .map((c, i) => `<td style="padding:8px 10px;border-top:1px solid #e2e8f0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:#0f172a;${i === 0 ? 'font-weight:600;' : ''}word-break:break-all;">${escapeHtml(String(c))}</td>`)
      .join('')}</tr>`
  }).join('')

  const textRecords = records
    .map(r => `${r.type ?? ''}  ${r.name ?? ''}  ${r.value ?? ''}${r.priority ? `  priority ${r.priority}` : ''}`)
    .join('\n')

  const html = `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
  <div style="max-width:640px;margin:0 auto;padding:28px 18px;">
    <h1 style="font-size:18px;margin:0 0 12px;">DNS records for ${safeBusiness} email</h1>
    <p style="font-size:14px;line-height:1.6;color:#334155;margin:0 0 16px;">
      ${safeName} uses PupManager to email their clients and needs these DNS records added to
      <strong>${safeDomain}</strong> so email sends from their own domain. Please add them at the domain's DNS host /
      registrar. Once they're in, ${safeName} can click <strong>Check verification</strong> in PupManager.
    </p>
    <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
      <thead><tr style="background:#f1f5f9;">
        ${['Type', 'Name / Host', 'Value', 'Priority', 'TTL'].map(h => `<th style="padding:8px 10px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.04em;color:#64748b;">${h}</th>`).join('')}
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="font-size:12px;color:#94a3b8;line-height:1.6;margin:18px 0 0;">
      Reply to this email to reach ${safeName} directly. Sent via PupManager.
    </p>
  </div>
</body></html>`

  const text = `DNS records for ${trainer.businessName} email\n\n${displayName} needs these DNS records added to ${trainer.sendingDomain} so email sends from their own domain:\n\n${textRecords}\n\nOnce added, ${displayName} can click "Check verification" in PupManager. Reply to reach ${displayName} directly.`

  try {
    await sendEmail({
      to: parsed.data.email,
      subject: `DNS records to set up email for ${trainer.businessName}`,
      from: fromTrainer(displayName),
      replyTo: trainer.user.email ?? undefined,
      html,
      text,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[sending-domain share]', msg)
    return NextResponse.json({ error: 'Could not send the email', detail: msg }, { status: 502 })
  }

  return NextResponse.json({ ok: true })
}
