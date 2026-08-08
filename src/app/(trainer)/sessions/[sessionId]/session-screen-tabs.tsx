'use client'

import { useState, type ReactNode } from 'react'
import { PageTabs } from '@/components/shared/page-tabs'

/**
 * A 1:1 session, as two tabs.
 *
 * Karl, 2026-08-08: "when you click on a session on the calendar we need to be
 * a bit clever and provide the trainer what they need depending on what they
 * are doing… a one on one session shows two tabs, the first tab is the details
 * of the dog and the owner, which should only take up a third of the screen,
 * and then below that should be the previous notes button. And then below that
 * should be a form for the session notes."
 *
 * So the first tab is the JOB: who's in front of you, what you wrote last
 * time, and the write-up you're filling in — in that order, because that is
 * the order a trainer needs them in during a session.
 *
 * Everything that isn't the write-up — photos, homework, time tracking, the
 * report preview, the way to the client's profile, deleting the session —
 * moves to the second tab. None of it is wrong; it just isn't what you're
 * doing while a dog is in the room, and it was pushing the form below the fold.
 *
 * The panels are both MOUNTED and toggled with `hidden`, never swapped: the
 * write-up holds unsaved text, and unmounting it to look at a photo would
 * throw that away.
 */
export function SessionScreenTabs({
  details,
  previousNotes,
  writeUp,
  more,
}: {
  /** Dog and owner. A third of the row on a wide screen, per Karl. */
  details: ReactNode
  /** The earlier write-ups for this client. Null when there are none. */
  previousNotes?: ReactNode
  /** The session notes form — the point of the screen. */
  writeUp: ReactNode
  /** Photos, homework, time, preview, profile, delete. */
  more: ReactNode
}) {
  const [tab, setTab] = useState<'session' | 'more'>('session')

  return (
    <>
      <div className="mb-4">
        <PageTabs
          label="Session sections"
          active={tab}
          onSelect={id => setTab(id as 'session' | 'more')}
          tabs={[
            { id: 'session', label: 'Session' },
            { id: 'more', label: 'More' },
          ]}
        />
      </div>

      <div className={tab === 'session' ? 'flex flex-col gap-4' : 'hidden'}>
        {/* A third of the width from lg up, full width below it — on a phone a
            third of the row is four words a line. It sits ABOVE the write-up
            rather than beside it: the form is the thing being filled in, and a
            column beside it would halve the room it has to do that in. */}
        <div className="lg:max-w-[33%]">{details}</div>
        {previousNotes}
        {writeUp}
      </div>

      <div className={tab === 'more' ? 'flex flex-col gap-4' : 'hidden'}>{more}</div>
    </>
  )
}
