import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

// Every email must leave through lib/email.ts.
//
// That is where two filters live, and both are invisible when you skip them:
//
//   * placeholder recipients are dropped — a client registered WITHOUT an email
//     is given one at @no-email.pupmanager.app precisely so nothing writes to
//     them, and that domain receives nothing
//   * a cancelled trainer's clients stop being mailed under their name
//
// A route that reaches for the Resend client itself opts out of both silently.
// It has already happened twice: the daily-reminders cron mailed every no-email
// client every morning, and the client-notify route told the trainer it had
// sent something that could only bounce. Neither showed up as an error
// anywhere — the send "succeeded".
//
// So this walks the source. It is a structural rule, not a behaviour test, and
// it is here because reviewing for it by eye demonstrably does not work.

const SRC = join(process.cwd(), 'src')

/**
 * Files allowed to talk to Resend directly, and why. Anything not on this list
 * must call sendEmail / sendEmailBatch.
 */
const ALLOWED = new Map<string, string>([
  ['lib/email.ts', 'the guard itself — this is the one place the client is meant to be used'],
  ['lib/auth-emails.ts', 'sign-in and verification mail, sent to an address the person just typed in'],
  ['app/api/auth/forgot-password/route.ts', 'a reset for an address the person typed; a placeholder client has none to type'],
  ['app/api/support/route.ts', 'writes to the PupManager team, never to a client'],
  ['app/api/clients/[clientId]/share/route.ts', 'writes to a partner address the trainer typed, not to a stored client address'],
])

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'generated' || entry === 'node_modules') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

describe('who is allowed to send email', () => {
  it('nothing outside lib/email.ts reaches for the Resend client', () => {
    const offenders: string[] = []

    for (const file of walk(SRC)) {
      const rel = relative(SRC, file).split(/[\\/]/).join('/')
      if (ALLOWED.has(rel)) continue
      const body = readFileSync(file, 'utf8')
      // Constructing the client, or sending through one.
      if (/new Resend\s*\(/.test(body) || /\.emails\.send\s*\(/.test(body) || /\.batch\.send\s*\(/.test(body)) {
        offenders.push(rel)
      }
    }

    expect(
      offenders,
      'These send email without the placeholder / cancelled-trainer filters. '
      + 'Use sendEmail from lib/email.ts, or add the file to ALLOWED with a reason.',
    ).toEqual([])
  })

  it('every allowance still points at a file that exists', () => {
    // An allowance for a deleted file is a hole waiting for someone to recreate
    // the path and inherit an exemption nobody meant to grant.
    const missing = [...ALLOWED.keys()].filter(rel => {
      try { return !statSync(join(SRC, rel)).isFile() } catch { return true }
    })
    expect(missing).toEqual([])
  })
})
