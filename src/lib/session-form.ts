/**
 * Which write-up form applies to THIS client, on THIS session, of THIS class?
 *
 * Three places can name one, and they answer increasingly specific questions:
 *
 *   1. the class            — "we always use the puppy form on this course"
 *   2. this session         — "week 6 is assessment night, use the assessment form"
 *   3. this client's enrolment — "Rex is in for reactivity; ask those questions"
 *
 * A class is one group but not one kind of client: a puppy on foundations and a dog
 * in for reactivity need different questions answered, in the same room, on the
 * same night. Before the enrolment layer existed, one form served everyone.
 *
 * Most specific wins. Null at a level means "no opinion, ask the next one out" —
 * NOT "no form", which matters because the common case is every field null and the
 * class default doing all the work.
 */

export interface SessionFormSources {
  /** ClassEnrollment.sessionFormId — this client, this class. */
  enrollmentFormId?: string | null
  /** TrainingSession.sessionFormId — this session, everyone in it. */
  sessionFormId?: string | null
  /** Package.defaultSessionFormId — the class's usual form. */
  classDefaultFormId?: string | null
}

export type SessionFormSource = 'enrollment' | 'session' | 'class' | 'none'

export interface ResolvedSessionForm {
  /** The form to use, or null for a recap-only write-up. */
  formId: string | null
  /** Which level decided, so the UI can say "just for this client". */
  from: SessionFormSource
}

export function resolveSessionForm(s: SessionFormSources): ResolvedSessionForm {
  const enrolment = s.enrollmentFormId?.trim()
  if (enrolment) return { formId: enrolment, from: 'enrollment' }

  const session = s.sessionFormId?.trim()
  if (session) return { formId: session, from: 'session' }

  const cls = s.classDefaultFormId?.trim()
  if (cls) return { formId: cls, from: 'class' }

  return { formId: null, from: 'none' }
}

/**
 * Is this client on something other than what the rest of the class gets?
 *
 * Used to mark the roster row, so a trainer can see at a glance that one person is
 * being asked different questions — otherwise a per-client override is invisible
 * until you open their write-up and wonder why it looks different.
 */
export function hasOwnSessionForm(s: SessionFormSources): boolean {
  return resolveSessionForm(s).from === 'enrollment'
}

/** What to call the source, for a chip on the roster. */
export function sessionFormSourceLabel(from: SessionFormSource): string | null {
  switch (from) {
    case 'enrollment': return 'Just for them'
    case 'session': return 'This session'
    case 'class': return null // the normal case needs no label
    case 'none': return null
  }
}
