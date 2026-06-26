import { NextResponse } from 'next/server'
import { z } from 'zod'
import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { resendClient } from '@/lib/email'

// Manage the trainer's bulk-email sending domain in Resend. The trainer always
// sends off a *subdomain* (mail.<their-domain>) — better deliverability and it
// keeps the broadcast reputation off their root domain. Flow:
//   POST   { domain }  → create the Resend domain, return DNS records to add
//   GET                → poll status, stamp domainVerifiedAt once verified
//   PUT                → ask Resend to (re)check verification now
//   DELETE             → disconnect and clear the fields

type ResendRecord = { record?: string; name?: string; type?: string; ttl?: string; status?: string; value?: string; priority?: string }

function normalizeDomain(input: string): string | null {
  const d = input.trim().toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/^www\./, '')
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)) return null
  return d.startsWith('mail.') ? d : `mail.${d}`
}

async function loadTrainer(trainerId: string) {
  return prisma.trainerProfile.findUnique({
    where: { id: trainerId },
    select: { sendingDomain: true, resendDomainId: true, sendingFromEmail: true, domainVerifiedAt: true, useTrialSendingDomain: true },
  })
}

export async function GET() {
  const guard = await guardPermission('settings.edit')
  if (guard instanceof NextResponse) return guard
  const t = await loadTrainer(guard.companyId)
  if (!t) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let records: ResendRecord[] = []
  let status: string | null = t.domainVerifiedAt ? 'verified' : null

  if (t.resendDomainId && !t.domainVerifiedAt) {
    const res = await resendClient().domains.get(t.resendDomainId)
    const data = res.data as { status?: string; records?: ResendRecord[] } | null
    status = data?.status ?? null
    records = data?.records ?? []
    if (status === 'verified') {
      await prisma.trainerProfile.update({ where: { id: guard.companyId }, data: { domainVerifiedAt: new Date() } })
    }
  }

  return NextResponse.json({
    sendingDomain: t.sendingDomain,
    sendingFromEmail: t.sendingFromEmail,
    verified: status === 'verified' || !!t.domainVerifiedAt,
    trialDomain: t.useTrialSendingDomain,
    status,
    records,
  })
}

export async function POST(req: Request) {
  const guard = await guardPermission('settings.edit')
  if (guard instanceof NextResponse) return guard

  const parsed = z.object({ domain: z.string().min(3).max(253) }).safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid domain' }, { status: 400 })
  const sendingDomain = normalizeDomain(parsed.data.domain)
  if (!sendingDomain) return NextResponse.json({ error: 'Enter a valid domain, e.g. yourbusiness.com' }, { status: 400 })

  // Replace any previous domain record so re-entering starts clean.
  const existing = await loadTrainer(guard.companyId)
  if (existing?.resendDomainId) {
    await resendClient().domains.remove(existing.resendDomainId).catch(() => {})
  }

  const res = await resendClient().domains.create({ name: sendingDomain })
  if (res.error || !res.data) {
    return NextResponse.json({ error: res.error?.message ?? 'Could not create domain' }, { status: 502 })
  }
  const data = res.data as { id: string; status?: string; records?: ResendRecord[] }

  await prisma.trainerProfile.update({
    where: { id: guard.companyId },
    data: {
      sendingDomain,
      resendDomainId: data.id,
      sendingFromEmail: `hello@${sendingDomain}`,
      domainVerifiedAt: null,
    },
  })

  return NextResponse.json({
    sendingDomain,
    sendingFromEmail: `hello@${sendingDomain}`,
    verified: false,
    status: data.status ?? 'pending',
    records: data.records ?? [],
  }, { status: 201 })
}

export async function PUT() {
  const guard = await guardPermission('settings.edit')
  if (guard instanceof NextResponse) return guard
  const t = await loadTrainer(guard.companyId)
  if (!t?.resendDomainId) return NextResponse.json({ error: 'No domain to verify' }, { status: 400 })

  // Trigger Resend to re-check DNS, then read back the status.
  await resendClient().domains.verify(t.resendDomainId).catch(() => {})
  const res = await resendClient().domains.get(t.resendDomainId)
  const data = res.data as { status?: string; records?: ResendRecord[] } | null
  const status = data?.status ?? null
  if (status === 'verified') {
    await prisma.trainerProfile.update({ where: { id: guard.companyId }, data: { domainVerifiedAt: new Date() } })
  }
  return NextResponse.json({
    sendingDomain: t.sendingDomain,
    sendingFromEmail: t.sendingFromEmail,
    verified: status === 'verified',
    status,
    records: data?.records ?? [],
  })
}

export async function DELETE() {
  const guard = await guardPermission('settings.edit')
  if (guard instanceof NextResponse) return guard
  const t = await loadTrainer(guard.companyId)
  if (t?.resendDomainId) {
    await resendClient().domains.remove(t.resendDomainId).catch(() => {})
  }
  await prisma.trainerProfile.update({
    where: { id: guard.companyId },
    data: { sendingDomain: null, resendDomainId: null, sendingFromEmail: null, domainVerifiedAt: null },
  })
  return NextResponse.json({ ok: true })
}
