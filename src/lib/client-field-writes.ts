import { CLIENT_FIELDS, type ClientFieldKey } from '@/lib/client-fields'
import type { Question } from '@/lib/session-form-builder'

/**
 * Turn a form's built-in-detail answers into writes on the real record.
 *
 * A CLIENT_FIELD question asks for something that BACKS A COLUMN — their name,
 * email, phone, address, or the dog's name, breed, weight, birthday, notes. So the
 * answer can't sit in the form's answer blob the way an ordinary question's does:
 * a name collected on an intake form has to BE the client's name, or the trainer
 * fills in a form and their client list still says "Unnamed".
 *
 * Three destinations, because that's where the columns live:
 *   • User        — name, email
 *   • ClientProfile — phone, address
 *   • Dog         — everything about the dog
 *
 * Deliberately conservative: a blank answer writes NOTHING. A client who skips an
 * optional question must not blank the phone number their trainer already typed in,
 * which is exactly what "just write what came back" would do.
 */

export interface ClientFieldWrites {
  user: Record<string, string>
  profile: Record<string, string>
  dog: Record<string, string | number | Date>
}

/** Which of the three records this detail lives on, and under what column. */
const COLUMN: Record<ClientFieldKey, { on: 'user' | 'profile' | 'dog'; column: string }> = {
  name: { on: 'user', column: 'name' },
  email: { on: 'user', column: 'email' },
  phone: { on: 'profile', column: 'phone' },
  address: { on: 'profile', column: 'address' },
  dogName: { on: 'dog', column: 'name' },
  dogBreed: { on: 'dog', column: 'breed' },
  dogWeight: { on: 'dog', column: 'weight' },
  dogDob: { on: 'dog', column: 'dob' },
  dogNotes: { on: 'dog', column: 'notes' },
}

const KNOWN = new Set<string>(CLIENT_FIELDS.map(f => f.key))

/** One answer, as it arrives from a form: a string, or a list for a multi-choice. */
type Answer = string | string[] | undefined

function asText(a: Answer): string {
  if (Array.isArray(a)) return a.join(', ').trim()
  return (a ?? '').trim()
}

export function collectClientFieldWrites(
  questions: Question[],
  answers: Record<string, Answer>,
): ClientFieldWrites {
  const out: ClientFieldWrites = { user: {}, profile: {}, dog: {} }

  for (const q of questions) {
    if (q.type !== 'CLIENT_FIELD') continue
    if (!KNOWN.has(q.fieldKey)) continue
    const value = asText(answers[q.id])
    // Blank means "they didn't answer", never "clear what's there".
    if (!value) continue

    const target = COLUMN[q.fieldKey as ClientFieldKey]
    if (target.on === 'user') { out.user[target.column] = value; continue }
    if (target.on === 'profile') { out.profile[target.column] = value; continue }

    // The dog's details need their real column types — a weight typed as "18.5"
    // is a number and a birthday is a date, or Prisma rejects the write.
    if (target.column === 'weight') {
      const n = Number(value)
      if (Number.isFinite(n) && n > 0) out.dog.weight = n
      continue
    }
    if (target.column === 'dob') {
      // Date-only, at UTC midnight, so a birthday doesn't slip a day across
      // timezones the way `new Date(value)` on a local string does.
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
      if (m) out.dog.dob = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00.000Z`)
      continue
    }
    out.dog[target.column] = value
  }

  return out
}

/** Did anything at all come back to write? */
export function hasClientFieldWrites(w: ClientFieldWrites): boolean {
  return Object.keys(w.user).length > 0
    || Object.keys(w.profile).length > 0
    || Object.keys(w.dog).length > 0
}
