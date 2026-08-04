import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * A RATCHET, not a rule.
 *
 * The two worst bugs of the 2026-08-04 audits were both an undo that undid one
 * of the things its action did: cancelling a shop order left the invoice
 * standing and the stock spent (C-3), and withdrawing a client from a class
 * left them owing for it (T-3). There are 66 DELETE routes in this app. Two had
 * been checked. Both were broken.
 *
 * So this test enumerates them and fails when a NEW one arrives with no test
 * naming it. The ones that were already untested when this was written are
 * listed below and allowed — the point is to stop the pile growing while it is
 * worked down, not to turn the whole backlog red today.
 *
 * When you cover one, delete its line. The list only ever gets shorter; a test
 * asserts that too, so it can't quietly be padded back out.
 */

const API = join(process.cwd(), 'src/app/api')

function deleteRoutes(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) { deleteRoutes(full, out); continue }
    if (entry !== 'route.ts') continue
    if (!/export async function DELETE/.test(readFileSync(full, 'utf8'))) continue
    out.push(full.replace(API, '').replace('/route.ts', ''))
  }
  return out
}

/** Every test file's text, concatenated once. */
function allTestSource(): string {
  const roots = [join(process.cwd(), 'tests/unit'), join(process.cwd(), 'tests/e2e')]
  let text = ''
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) { walk(full); continue }
      if (/\.(test|spec)\.ts$/.test(entry)) text += readFileSync(full, 'utf8')
    }
  }
  for (const r of roots) walk(r)
  return text
}

/**
 * Undo paths with no test naming them, as at 2026-08-04. Each one is a place
 * where "cancel" might undo less than "create" did. Shrink this list.
 */
const KNOWN_UNTESTED = new Set([
  '/achievements/[achievementId]',
  '/admin/announcements/[id]',
  '/admin/onboarding-emails/[id]/image',
  '/admin/promo-codes/[codeId]',
  '/admin/trainer-notes/[id]',
  '/admin/trainer-tasks/[id]',
  '/admin/trainers/[trainerId]',
  '/availability/[slotId]',
  '/blackouts/[blackoutId]',
  '/clients/[clientId]/achievements/[achievementId]',
  '/clients/[clientId]/dogs/[dogId]',
  '/custom-fields/[fieldId]',
  '/devices/register',
  '/dogs/[dogId]',
  '/dogs/[dogId]/media/[mediaId]',
  '/dogs/[dogId]/photo',
  '/email-templates/[id]',
  '/embed-forms/[formId]',
  '/library/types/[typeId]',
  '/message-groups/[groupId]',
  '/message-groups/[groupId]/messages/[messageId]',
  '/message-groups/[groupId]/participants/[participantId]',
  '/my/memberships/[membershipId]/request',
  '/products/categories/[categoryId]',
  '/review/comments/[id]',
  '/schedule/[sessionId]/buddies/[buddyId]',
  '/schedule/notify-reschedules',
  '/session-forms/[formId]',
  '/sessions/[sessionId]/attachments/[attachmentId]',
  '/sessions/[sessionId]/form-responses/[formId]',
  '/sessions/[sessionId]/time-entries',
  '/system-emails',
  '/tags/[tagId]',
  '/tasks/[taskId]',
  '/tasks/[taskId]/complete',
  '/time-rates/[id]',
  '/timesheets/[id]',
  '/timesheets/[id]/entries/[entryId]',
  '/timesheets/[id]/finalise',
  '/todos/[todoId]',
  '/trainer/booking-pages/[id]',
  '/trainer/booking-pages/[id]/automations/[autoId]',
  '/trainer/class-runs/[runId]/comms-flow/[stepId]',
  '/trainer/comms-flow-templates/[templateId]',
  '/trainer/discounts/[id]',
  '/trainer/lead-magnets/[id]',
  '/trainer/locations/[id]',
  // '/trainer/memberships/[id]' — covered 2026-08-04 by audit-trainer-money.spec (T-5)
  '/trainer/memberships/[id]/comms-flow/[stepId]',
  '/trainer/memberships/[id]/invites',
])

describe('every undo path is either tested or on the list', () => {
  const routes = deleteRoutes(API)
  const source = allTestSource()

  it('finds the DELETE routes at all (guards the walker itself)', () => {
    expect(routes.length).toBeGreaterThan(50)
  })

  it('has no NEW untested undo path', () => {
    // Named by its literal path with the dynamic segments left in — that's how
    // a spec writes it in a comment or a describe(), and matching the resolved
    // URL would need the route table.
    const untested = routes.filter(r => {
      const literal = r.replace(/\[[^\]]+\]/g, '')
      const named = source.includes(r) || (literal.length > 8 && source.includes(literal))
      return !named && !KNOWN_UNTESTED.has(r)
    })
    expect(
      untested,
      `New DELETE route with no test.\n\n` +
      `Ask what the matching create did, and make sure the undo undoes all of it\n` +
      `— stock, invoice, seat, notification. That is audit C-3 and T-3, twice.\n` +
      `Then name the route in the test, or add it to KNOWN_UNTESTED with a reason.`,
    ).toEqual([])
  })

  it('the backlog list only ever shrinks', () => {
    // Stops the escape hatch becoming the habit: nothing may sit in
    // KNOWN_UNTESTED that isn't actually a DELETE route any more.
    const stale = [...KNOWN_UNTESTED].filter(r => !routes.includes(r))
    expect(stale, 'these are covered or gone — delete them from KNOWN_UNTESTED').toEqual([])
  })
})
