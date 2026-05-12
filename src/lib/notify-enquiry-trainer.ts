import { prisma } from '@/lib/prisma'
import { sendApns, INVALID_TOKEN_REASONS } from '@/lib/apns'
import { resolvePref } from '@/lib/notification-prefs'
import { renderTemplate } from '@/lib/notification-types'

// Push the trainer when a public form submission lands (embed form or
// intake form). Fire-and-forget from the caller's perspective — errors
// are swallowed and logged so a flaky APNs round-trip can't fail the
// public form's response.

interface NotifyArgs {
  enquiryId: string
  trainerId: string
  name: string
  email: string
  dogName?: string | null
  message?: string | null
}

export async function notifyEnquiryTrainer(args: NotifyArgs): Promise<void> {
  try {
    await doNotify(args)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    console.error('[notify-enquiry-trainer] failed:', msg)
  }
}

async function doNotify({ enquiryId, trainerId, name, email, dogName, message }: NotifyArgs) {
  const trainer = await prisma.trainerProfile.findUnique({
    where: { id: trainerId },
    select: { user: { select: { id: true } } },
  })
  if (!trainer?.user) return

  const pref = await resolvePref(trainer.user.id, 'NEW_ENQUIRY', 'PUSH')
  if (!pref.enabled) return

  const tokens = await prisma.deviceToken.findMany({
    where: { userId: trainer.user.id, platform: 'IOS' },
    select: { token: true },
  })
  if (tokens.length === 0) return

  const preview = previewMessage(message ?? `${name} just submitted your form.`)
  const values = {
    name,
    email,
    dogName: dogName ?? '',
    preview,
  }
  const title = renderTemplate(pref.title, values)
  const body = renderTemplate(pref.body, values)

  const results = await sendApns(
    tokens.map(t => t.token),
    {
      alert: { title, body },
      customData: { type: 'new-enquiry', enquiryId, path: `/enquiries/${enquiryId}` },
    },
  )

  const stale = results
    .filter(r => !r.ok && r.reason && INVALID_TOKEN_REASONS.has(r.reason))
    .map(r => r.token)
  if (stale.length > 0) {
    await prisma.deviceToken.deleteMany({ where: { token: { in: stale } } })
  }
}

function previewMessage(body: string): string {
  const trimmed = body.trim().replace(/\s+/g, ' ')
  if (trimmed.length <= 120) return trimmed
  return trimmed.slice(0, 117) + '…'
}
