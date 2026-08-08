'use client'

import { useState, type ReactNode } from 'react'
import { PageTabs } from '@/components/shared/page-tabs'

/**
 * A 1:1 session, as three tabs — the SAME three the calendar's popover uses
 * (Karl: "this doesn't look anything like the desktop version"). A phone opens
 * this page where a desktop opens that popover, so they have to agree: Notes,
 * Previous, Details, in that order, opening on Notes.
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
  const [tab, setTab] = useState<'notes' | 'previous' | 'details'>('notes')

  return (
    <>
      {/* Who, and when — ABOVE the tabs (Karl), not inside one. It is true of
          the whole screen, not of a section of it: the same dog and the same
          Thursday whether you're writing the report, reading the last one, or
          changing the booking. A copy in each tab would be three copies. */}
      <div className="mb-4">{details}</div>

      <div className="mb-4">
        <PageTabs
          label="Session sections"
          active={tab}
          onSelect={id => setTab(id as 'notes' | 'previous' | 'details')}
          tabs={[
            { id: 'notes', label: 'Notes' },
            { id: 'previous', label: 'Previous' },
            { id: 'details', label: 'Details' },
          ]}
        />
      </div>

      {/* All three MOUNTED, toggled with `hidden`: the write-up holds unsaved
          text, and unmounting it to check last week's notes would throw it
          away. */}
      <div className={tab === 'notes' ? 'flex flex-col gap-4' : 'hidden'}>{writeUp}</div>

      <div className={tab === 'previous' ? 'flex flex-col gap-4' : 'hidden'}>
        {previousNotes ?? (
          <p className="px-1 text-[13px] text-slate-400">Nothing written up for this client yet.</p>
        )}
      </div>

      {/* Everything that isn't the write-up: photos, homework, time tracking,
          the report preview, the way to the client, delete. The facts card
          lives on Notes now, not here — one copy, where it's used. */}
      <div className={tab === 'details' ? 'flex flex-col gap-4' : 'hidden'}>{more}</div>
    </>
  )
}
