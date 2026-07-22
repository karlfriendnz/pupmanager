import { prisma } from './prisma'
import { sendEmail, fromTrainer } from './email'
import { emailBodyToHtml } from './email-html'
import { escapeHtml } from './html-escape'

// Auto-reply sent to the PERSON WHO FILLED IN A FORM, immediately on submit.
//
// Distinct from the welcome email in enquiries.ts, which goes out later when
// the trainer accepts the enquiry and opts into a magic link. This one fires
// straight away so nobody submits a form into silence — and deliberately
// carries NO login link: at submit time the enquiry is unaccepted, so no
// client account exists to log in to.
//
// Per form the trainer picks one of:
//   OFF      — send nothing (the default, so existing forms are unchanged)
//   TEMPLATE — send one of their saved EmailTemplates
//   CUSTOM   — send subject/body written on the form itself

export type AutoReplyMode = 'OFF' | 'TEMPLATE' | 'CUSTOM'

export function isAutoReplyMode(v: string): v is AutoReplyMode {
  return v === 'OFF' || v === 'TEMPLATE' || v === 'CUSTOM'
}

// Same placeholder vocabulary as the welcome email, so trainers only learn
// one. `escape` is false for the subject (plain text) and true for HTML.
function fillPlaceholders(template: string, vars: { business: string; name: string }, escape: boolean): string {
  const business = escape ? escapeHtml(vars.business) : vars.business
  const name = escape ? escapeHtml(vars.name) : vars.name
  return template.replace(/\{business\}/g, business).replace(/\{name\}/g, name)
}

interface AutoReplyConfig {
  autoReplyMode: string
  autoReplySubject: string | null
  autoReplyBody: string | null
  autoReplyTemplate: { subject: string; body: string } | null
}

/**
 * Resolve the subject/body a form should auto-reply with, or null when it
 * shouldn't send at all. Pure — no IO — so the send path and the tests can
 * both reason about it.
 *
 * Returns null when: mode is OFF; mode is TEMPLATE but the template is
 * missing (deleted → FK set null); or the resolved subject/body is blank.
 */
export function resolveAutoReply(
  form: AutoReplyConfig,
  vars: { business: string; name: string },
): { subject: string; html: string } | null {
  let rawSubject: string | null = null
  let rawBody: string | null = null

  if (form.autoReplyMode === 'TEMPLATE') {
    if (!form.autoReplyTemplate) return null
    rawSubject = form.autoReplyTemplate.subject
    rawBody = form.autoReplyTemplate.body
  } else if (form.autoReplyMode === 'CUSTOM') {
    rawSubject = form.autoReplySubject
    rawBody = form.autoReplyBody
  } else {
    return null // OFF, or an unrecognised value — fail closed, never send.
  }

  const subject = fillPlaceholders((rawSubject ?? '').trim(), vars, false)
  const bodyRaw = (rawBody ?? '').trim()
  // A half-configured form (mode set, copy blank) must not send an empty
  // email — treat it as off until they finish writing it.
  if (!subject || !bodyRaw) return null

  return {
    subject,
    html: emailBodyToHtml(fillPlaceholders(bodyRaw, vars, false)),
  }
}

/**
 * Fire the auto-reply for a submitted enquiry. Best-effort by design: the
 * public submit endpoint must return 201 even if Resend is having a bad day,
 * so every failure is swallowed and logged.
 */
export async function sendFormAutoReply(enquiryId: string): Promise<void> {
  try {
    const enquiry = await prisma.enquiry.findUnique({
      where: { id: enquiryId },
      select: {
        name: true,
        email: true,
        trainer: { select: { businessName: true, publicEmail: true } },
        form: {
          select: {
            autoReplyMode: true,
            autoReplySubject: true,
            autoReplyBody: true,
            autoReplyTemplate: { select: { subject: true, body: true } },
          },
        },
      },
    })
    if (!enquiry?.form || !enquiry.email) return

    const businessName = enquiry.trainer.businessName || 'Your trainer'
    const resolved = resolveAutoReply(enquiry.form, {
      business: businessName,
      name: enquiry.name,
    })
    if (!resolved) return

    await sendEmail({
      to: enquiry.email,
      subject: resolved.subject,
      html: resolved.html,
      // "Business via PupManager" — our verified sender (arbitrary domains
      // fail SPF/DKIM), with replies routed to the trainer's public address.
      from: fromTrainer(businessName),
      ...(enquiry.trainer.publicEmail ? { replyTo: enquiry.trainer.publicEmail } : {}),
    })
  } catch (err) {
    console.error('[form auto-reply] send failed', enquiryId, err)
  }
}
