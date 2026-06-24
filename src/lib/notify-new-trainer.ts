import { sendEmail } from './email'

// Internal heads-up when a new trainer signs up. Goes to the founders.
const FOUNDER_RECIPIENTS = ['karlfriend.nz@gmail.com', 'brookeallise@gmail.com']

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Email the founders that a new trainer joined. Fire-and-forget: uses
// allSettled so a failed notification never breaks the signup flow.
export async function notifyNewTrainerSignup({
  name, businessName, email, source,
}: { name: string; businessName: string; email: string; source?: string }) {
  const subject = `🐶 New PupManager trainer: ${businessName}`
  const rows: [string, string][] = [
    ['Name', name],
    ['Business', businessName],
    ['Email', email],
    ...(source ? ([['Signed up via', source]] as [string, string][]) : []),
  ]
  const html = `
    <div style="font-family:system-ui,sans-serif;font-size:15px;color:#0f1f24;line-height:1.5">
      <p style="font-size:16px;font-weight:600">A new trainer just signed up for PupManager 🎉</p>
      <table style="border-collapse:collapse;margin-top:8px">
        ${rows.map(([k, v]) => `<tr><td style="padding:4px 16px 4px 0;color:#5b7682">${esc(k)}</td><td style="padding:4px 0;font-weight:600">${esc(v)}</td></tr>`).join('')}
      </table>
    </div>`
  const text = `New PupManager trainer signup\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}`

  await Promise.allSettled(
    FOUNDER_RECIPIENTS.map(to => sendEmail({ to, subject, html, text })),
  )
}

// Email the founders when a trainer cancels (self-deletes) their account, with
// the reason they gave. Fire-and-forget: allSettled so a failed notification
// never breaks the deletion flow.
export async function notifyTrainerDeletion({
  name, businessName, email, phone, reason, okToCall,
}: { name: string; businessName: string; email: string; phone?: string | null; reason: string | null; okToCall?: boolean }) {
  const callLabel = okToCall
    ? `✅ YES — happy for Brooke to call${phone?.trim() ? ` on ${phone.trim()}` : ' (no phone on file)'}`
    : 'No'
  const subject = `${okToCall ? '📞' : '😿'} Trainer cancelled: ${businessName}`
  const rows: [string, string][] = [
    ['Name', name],
    ['Business', businessName],
    ['Email', email],
    ['Phone', phone?.trim() || '(none on file)'],
    ['OK to call?', callLabel],
    ['Reason', reason?.trim() || '(none given)'],
  ]
  const html = `
    <div style="font-family:system-ui,sans-serif;font-size:15px;color:#0f1f24;line-height:1.5">
      <p style="font-size:16px;font-weight:600">A trainer just cancelled their PupManager account.</p>
      <table style="border-collapse:collapse;margin-top:8px">
        ${rows.map(([k, v]) => `<tr><td style="padding:4px 16px 4px 0;color:#5b7682;vertical-align:top">${esc(k)}</td><td style="padding:4px 0;font-weight:600;white-space:pre-wrap">${esc(v)}</td></tr>`).join('')}
      </table>
      <p style="margin-top:12px;color:#5b7682;font-size:13px">The account is deactivated and recoverable for 30 days — reinstate from /admin/trainers if they reach out.</p>
    </div>`
  const text = `Trainer cancelled PupManager\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}`

  await Promise.allSettled(
    FOUNDER_RECIPIENTS.map(to => sendEmail({ to, subject, html, text })),
  )
}
