'use server'

type ActionState =
  | { ok: true }
  | { ok: false; error: string }
  | { ok: null }

const FROM = process.env.CONTACT_FROM_EMAIL || 'PupManager <noreply@pupmanager.com>'
const TO = process.env.CONTACT_TO_EMAIL || 'info@pupmanager.com'

export async function submitContact(_prev: ActionState, formData: FormData): Promise<ActionState> {
  // Honeypot: bots tend to fill every field. Real users don't see this one.
  if ((formData.get('website') as string)?.length) {
    return { ok: true } // pretend success, drop silently
  }

  const name = String(formData.get('name') || '').trim()
  const email = String(formData.get('email') || '').trim()
  const role = String(formData.get('role') || '').trim()
  const message = String(formData.get('message') || '').trim()

  if (!name || name.length > 200) return { ok: false, error: 'Please add your name.' }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
    return { ok: false, error: 'That email address doesn\'t look right.' }
  }
  if (!message) return { ok: false, error: 'Please add a message.' }
  if (message.length > 5000) return { ok: false, error: 'Message is too long (max 5000 chars).' }

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.error('[contact] RESEND_API_KEY is not set; cannot deliver form submission.')
    return { ok: false, error: 'Sorry — the form is temporarily unavailable. Email info@pupmanager.com directly.' }
  }

  const subject = `[pupmanager.com] ${role ? `(${role}) ` : ''}${name}`
  const text = [
    `Name:    ${name}`,
    `Email:   ${email}`,
    role ? `Role:    ${role}` : null,
    '',
    message,
  ]
    .filter(Boolean)
    .join('\n')

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM,
      to: [TO],
      reply_to: email,
      subject,
      text,
    }),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    console.error('[contact] Resend send failed', res.status, detail)
    return { ok: false, error: 'Sorry — something went wrong. Please email info@pupmanager.com.' }
  }

  return { ok: true }
}
