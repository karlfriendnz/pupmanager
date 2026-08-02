import { prisma } from './prisma'
import { env } from './env'
import { sendEmail, fromTrainer } from './email'
import { renderTrainerEmail } from './trainer-email-shell'
import { escapeHtml } from './html-escape'
import { continuationPath } from './form-continuation'

/**
 * "Pick up where you left off."
 *
 * The run lives in the URL, which survives a refresh and the back button — but
 * not a closed tab, and closing the tab at the password step is exactly what a
 * distracted person does. So the same link goes to their inbox the moment the
 * enquiry lands. It is not a verification wall and it is not something they are
 * asked to wait for: by the time it arrives they are usually already through.
 * It is the door back in for the ones who aren't.
 *
 * Trainer-branded, like every other email a dog owner gets from their trainer —
 * they filled in Mersea Mutts' form and have never heard of PupManager.
 *
 * Best-effort: callers swallow and log. A courtesy email must never fail a
 * submission.
 */
export async function sendContinuationEmail(args: {
  enquiryId: string
  plainToken: string
}): Promise<void> {
  const enquiry = await prisma.enquiry.findUnique({
    where: { id: args.enquiryId },
    select: {
      email: true,
      name: true,
      unifiedFormId: true,
      trainer: { select: { businessName: true, logoUrl: true, emailAccentColor: true } },
    },
  })
  if (!enquiry?.email || !enquiry.unifiedFormId) return

  const firstName = enquiry.name.trim().split(/\s+/)[0] || enquiry.name.trim()
  const business = escapeHtml(enquiry.trainer.businessName)
  const url = `${env.NEXT_PUBLIC_APP_URL}${continuationPath(enquiry.unifiedFormId, args.plainToken)}`

  const html = renderTrainerEmail({
    trainer: enquiry.trainer,
    title: `Finish setting up with ${enquiry.trainer.businessName}`,
    preheader: 'Your link to pick up where you left off.',
    bodyHtml:
      `<p>Hi ${escapeHtml(firstName)},</p>` +
      `<p>Thanks for getting in touch with <strong>${business}</strong>. ` +
      `We've got your answers. The last step is a password, so you can see your ` +
      `sessions, notes and messages in one place.</p>` +
      `<p>This link works for the next 24 hours, and only once.</p>`,
    ctaLabel: 'Finish setting up',
    ctaUrl: url,
    footerNote: `If you didn't fill in a form for ${enquiry.trainer.businessName}, you can ignore this — no account has been created.`,
  })

  const text =
    `Hi ${firstName},\n\n` +
    `Thanks for getting in touch with ${enquiry.trainer.businessName}. We've got your answers. ` +
    `The last step is a password, so you can see your sessions, notes and messages in one place.\n\n` +
    `${url}\n\n` +
    `This link works for the next 24 hours, and only once.\n\n` +
    `If you didn't fill in a form for ${enquiry.trainer.businessName}, you can ignore this — no account has been created.`

  await sendEmail({
    to: enquiry.email,
    subject: `Finish setting up with ${enquiry.trainer.businessName}`,
    from: fromTrainer(enquiry.trainer.businessName),
    html,
    text,
  })
}
