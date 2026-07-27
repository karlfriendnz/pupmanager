'use client'

import { useSearchParams } from 'next/navigation'

// What just happened when you came back from Google.
//
// Every failure in the connect flow used to redirect to the same
// `?googlecalendar=error` on a page that rendered nothing for it. A trainer
// clicked Connect, went to Google, came back, and saw a page identical to the
// one they left — reported to us as the connection "hanging". It never hung: it
// failed silently, five different ways, none of them distinguishable.
//
// So every reason names itself and gets a sentence saying what to do. The point
// is not the wording — it is that a support report can now say WHICH one.

const MESSAGES: Record<string, { tone: 'ok' | 'warn'; title: string; body: string }> = {
  connected: {
    tone: 'ok',
    title: 'Google Calendar connected',
    body: 'Your sessions will appear in your calendar, and anything already in it will show on your schedule.',
  },
  denied: {
    tone: 'warn',
    title: 'You didn’t finish signing in to Google',
    body: 'Nothing was connected. Try again and choose Allow on the Google screen.',
  },
  expired: {
    tone: 'warn',
    title: 'That took too long, so we stopped',
    body: 'The sign-in link is only good for ten minutes. Start again and it should go straight through.',
  },
  nocode: {
    tone: 'warn',
    title: 'Google sent us back without an answer',
    body: 'Nothing was connected. Try once more — if it happens again, tell us and we’ll look.',
  },
  norefresh: {
    tone: 'warn',
    title: 'Google didn’t give us lasting access',
    body: 'This can happen if PupManager already has permission on your Google account. Remove PupManager under your Google account’s “Third-party access”, then connect again.',
  },
  exchange: {
    tone: 'warn',
    title: 'Google turned us away',
    body: 'This is a setting on our side, not something you can fix. Tell us and we’ll sort it.',
  },
  nomember: {
    tone: 'warn',
    title: 'We couldn’t match that to your account',
    body: 'Try connecting again from this page.',
  },
  unconfigured: {
    tone: 'warn',
    title: 'Google Calendar isn’t switched on for PupManager yet',
    body: 'Nothing you’ve done is wrong — this one is ours. Tell us and we’ll enable it.',
  },
  google: {
    tone: 'warn',
    title: 'Google reported a problem',
    body: 'Nothing was connected. Try again, and tell us if it keeps happening.',
  },
}

export function GoogleCalendarStatus() {
  const params = useSearchParams()
  const msg = MESSAGES[params.get('googlecalendar') ?? '']
  if (!msg) return null

  const ok = msg.tone === 'ok'
  return (
    <div
      role="status"
      className={
        ok
          ? 'mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4'
          : 'mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4'
      }
    >
      <p className={ok ? 'text-sm font-medium text-emerald-900' : 'text-sm font-medium text-amber-900'}>
        {msg.title}
      </p>
      <p className={ok ? 'mt-1 text-sm text-emerald-800' : 'mt-1 text-sm text-amber-800'}>{msg.body}</p>
    </div>
  )
}
