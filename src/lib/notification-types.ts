import type { NotificationType, NotificationChannel } from '@/generated/prisma'

// Single source of truth for everything about each notification type:
// human label, default channels, default copy, and what placeholders are
// available so the settings UI can show users what they can substitute.

export type TriggerKind = 'time-before-event' | 'time-of-day' | 'event'

export interface NotificationTypeMeta {
  type: NotificationType
  label: string
  description: string
  trigger: TriggerKind
  // Channels supported. Channels not listed are hidden from the UI.
  channels: NotificationChannel[]
  // Defaults applied when no NotificationPreference row exists for this user.
  defaults: {
    enabled: boolean
    minutesBefore?: number      // for time-before-event
    dailyAtHour?: number        // for time-of-day (0–23)
    title: string
    body: string
  }
  // Placeholder names that the sender will substitute. Surfaced in the
  // settings UI so users know what they can use in custom titles/bodies.
  placeholders: string[]
  // Sample values used by the "send test" button so the test push reads
  // realistically instead of with literal {{placeholders}}.
  sampleValues: Record<string, string>
  // When false, the settings panel hides the time-of-day, title, body
  // and placeholder controls — the trainer can only flip channels on
  // or off. The cron skips reading any of those preference fields for
  // these types and always uses the defaults at the canonical time.
  // Defaults to true (everything customisable) for backwards compat.
  customisable?: boolean
  // Who the notification is for. Defaults to 'trainer' (the trainer settings
  // panel filters on this so client types don't appear there).
  audience?: 'trainer' | 'client'
  // For client types: which channels are ON by default when the client has no
  // preference row yet — lets us default push+feed but not email. Falls back
  // to all `channels` when omitted.
  defaultChannels?: NotificationChannel[]
}

export const NOTIFICATION_TYPES: Record<NotificationType, NotificationTypeMeta> = {
  SESSION_REMINDER: {
    type: 'SESSION_REMINDER',
    label: 'Upcoming session',
    description: 'Heads-up that one of your sessions is starting soon.',
    trigger: 'time-before-event',
    channels: ['PUSH', 'EMAIL'],
    defaults: {
      enabled: true,
      minutesBefore: 20,
      title: 'Upcoming session — {{dogName}}',
      body: '{{title}} at {{startTime}} (in ~{{minutesBefore}} min)',
    },
    placeholders: ['dogName', 'clientName', 'title', 'startTime', 'minutesBefore'],
    sampleValues: {
      dogName: 'Rusty',
      clientName: 'Liz Reed',
      title: 'Walk & Coach',
      startTime: '2:30 pm',
      minutesBefore: '20',
    },
  },
  SESSION_NOTES_REMINDER: {
    type: 'SESSION_NOTES_REMINDER',
    label: 'Wrap up & write notes',
    // Sentinel "time-before-event" trigger here means "before session END"
    // — interpretation lives in the cron, not in this metadata.
    description: 'Nudge to write session notes near the end of a session, while it\'s still fresh.',
    trigger: 'time-before-event',
    channels: ['PUSH', 'EMAIL'],
    defaults: {
      enabled: true,
      minutesBefore: 5,
      title: 'Wrap-up time — {{dogName}}',
      body: 'Add notes for {{title}} now while it\'s fresh. Session ends in ~{{minutesBefore}} min.',
    },
    placeholders: ['dogName', 'clientName', 'title', 'endTime', 'minutesBefore'],
    sampleValues: {
      dogName: 'Tilly',
      clientName: 'Grace Wilshaw',
      title: 'Recall practice',
      endTime: '5:15 pm',
      minutesBefore: '5',
    },
  },
  DAILY_SUMMARY: {
    type: 'DAILY_SUMMARY',
    label: 'Morning summary',
    description: 'A quick rundown of your sessions and tasks for the day. When you have nothing booked, the trainer can opt to receive a friendlier "take the day off" message instead.',
    trigger: 'time-of-day',
    channels: ['PUSH', 'EMAIL'],
    defaults: {
      enabled: true,
      dailyAtHour: 7,
      title: 'Good morning ☀️',
      body: 'You have {{sessionCount}} session(s) and {{clientCount}} active client(s) today.',
    },
    placeholders: ['sessionCount', 'clientCount', 'firstSessionTime'],
    sampleValues: {
      sessionCount: '3',
      clientCount: '12',
      firstSessionTime: '9:00 am',
    },
  },
  WEEKLY_SUMMARY: {
    type: 'WEEKLY_SUMMARY',
    label: 'Sunday wrap-up',
    description: "A weekly recap on Sunday evening — sessions you ran, money earned, and a glance at the week ahead. Always 7pm Sunday in your timezone, with copy we look after on your behalf.",
    trigger: 'time-of-day',
    channels: ['PUSH', 'EMAIL'],
    // Locked: trainers don't tweak the time, title, or body. The
    // email's tables + intro/outro are too rich to expose as a
    // template, and the push is one line we curate centrally so it
    // stays warm and consistent.
    customisable: false,
    defaults: {
      enabled: true,
      // 19 = 7pm in the trainer's local timezone. Cron only fires this
      // type when the local day-of-week is Sunday (see /api/cron/weekly-summary).
      dailyAtHour: 19,
      title: 'Great week! 🎉',
      body: '{{sessionsCompleted}} sessions done, {{revenue}} earned. {{nextWeekSessions}} booked + {{nextWeekTasks}} tasks for next week.',
    },
    placeholders: ['sessionsCompleted', 'revenue', 'nextWeekSessions', 'nextWeekTasks'],
    sampleValues: {
      sessionsCompleted: '12',
      revenue: '$480',
      nextWeekSessions: '8',
      nextWeekTasks: '23',
    },
  },
  NEW_CLIENT_INVITE_ACCEPTED: {
    type: 'NEW_CLIENT_INVITE_ACCEPTED',
    label: 'Client signed up',
    description: 'A client used your invite link and finished onboarding.',
    trigger: 'event',
    channels: ['PUSH', 'EMAIL'],
    defaults: {
      enabled: true,
      title: 'New client onboard 🎉',
      body: '{{clientName}} just signed up with {{dogName}}.',
    },
    placeholders: ['clientName', 'dogName'],
    sampleValues: {
      clientName: 'Brooke Friend',
      dogName: 'Mila',
    },
  },
  CLIENT_COMPLETED_TASKS: {
    type: 'CLIENT_COMPLETED_TASKS',
    label: 'Client finished today',
    description: 'A client completed every training task you assigned today.',
    trigger: 'event',
    channels: ['PUSH', 'EMAIL'],
    defaults: {
      enabled: false, // off by default — high-volume trainers would get spammed
      title: 'All done ✅ — {{dogName}}',
      body: '{{clientName}} completed all {{taskCount}} task(s) today.',
    },
    placeholders: ['clientName', 'dogName', 'taskCount'],
    sampleValues: {
      clientName: 'Liz Reed',
      dogName: 'Rusty',
      taskCount: '4',
    },
  },
  NEW_ENQUIRY: {
    type: 'NEW_ENQUIRY',
    label: 'New enquiry',
    description: 'Someone filled in one of your public forms (embed or intake).',
    trigger: 'event',
    // PUSH for the in-pocket buzz, EMAIL so the trainer has the full
    // enquiry in their inbox to reply from (or forward, or read at
    // their desk).
    channels: ['PUSH', 'EMAIL'],
    defaults: {
      enabled: true,
      title: '🐾 New enquiry from {{name}}',
      body: '{{preview}}',
    },
    placeholders: ['name', 'email', 'dogName', 'preview'],
    sampleValues: {
      name: 'Jess Carter',
      email: 'jess@example.com',
      dogName: 'Bailey',
      preview: 'Looking for help with reactivity on walks.',
    },
  },
  ENQUIRY_FOLLOWUP_REMINDER: {
    type: 'ENQUIRY_FOLLOWUP_REMINDER',
    label: 'Unanswered enquiry nudge',
    description:
      "If you haven't replied to a new enquiry, we'll nudge you at 6, 18, 24 and 36 hours so a hot lead doesn't go cold. The nudges stop the moment you reply, accept or decline. Timing and copy we look after for you.",
    trigger: 'event',
    channels: ['PUSH', 'EMAIL'],
    // Locked: the 6/18/24/36h cadence and copy are curated centrally — the
    // trainer can only flip the channels on or off.
    customisable: false,
    defaults: {
      enabled: true,
      title: "⏰ Still waiting — {{name}}",
      body: "{{name}}'s enquiry has been sitting for {{waited}} with no reply. Tap to get back to them.",
    },
    placeholders: ['name', 'dogName', 'email', 'waited', 'hours'],
    sampleValues: {
      name: 'Jess Carter',
      dogName: 'Bailey',
      email: 'jess@example.com',
      waited: '6 hours',
      hours: '6',
    },
  },
  NEW_MESSAGE: {
    type: 'NEW_MESSAGE',
    label: 'New message',
    description: 'Someone sent you a message in the app.',
    trigger: 'event',
    channels: ['PUSH', 'EMAIL'],
    defaults: {
      enabled: true,
      title: 'Message from {{senderName}}',
      body: '{{preview}}',
    },
    // `clientName` kept as a placeholder for backward compatibility with
    // trainers who already customised "Message from {{clientName}}" in
    // their settings — the sender helper passes both senderName and
    // clientName so existing templates keep rendering.
    placeholders: ['senderName', 'clientName', 'preview'],
    sampleValues: {
      senderName: 'Grace Wilshaw',
      clientName: 'Grace Wilshaw',
      preview: 'Hi! Just wondering about Tilly\'s next session…',
    },
  },
  STREAK_UPDATE: {
    type: 'STREAK_UPDATE',
    label: 'Notes reminder',
    description: "An evening nudge on training days — if you haven't logged in or finished your session notes by 8pm, we'll remind you so your training-day streak stays alive. Copy we look after for you.",
    trigger: 'time-of-day',
    channels: ['PUSH', 'EMAIL'],
    // Locked: one curated line, fixed 8pm time, training days only.
    customisable: false,
    defaults: {
      enabled: true,
      dailyAtHour: 20,
      title: 'Notes due 📝',
      body: '{{message}}',
    },
    placeholders: ['message', 'weeks'],
    sampleValues: {
      message: "Finish today's notes to keep your 5-day streak alive.",
      weeks: '5',
    },
  },

  // ─── Client-facing (the dog owner) ───────────────────────────────────────
  // Client channels: Phone (push), Email, App (the in-app notifications feed).
  // For "before each session" each channel's leadMinutes holds which lead times
  // it delivers, so the client can route each lead independently.
  CLIENT_ADDED_TO_PLAN: {
    type: 'CLIENT_ADDED_TO_PLAN',
    label: 'Added to a plan',
    description: "When your trainer books you into a package, class or session.",
    trigger: 'event',
    audience: 'client',
    channels: ['PUSH', 'EMAIL', 'IN_APP'],
    defaultChannels: ['PUSH', 'EMAIL', 'IN_APP'],
    defaults: {
      enabled: true,
      title: "You're booked in",
      body: '{{trainerName}} added {{dogName}} to {{planName}}',
    },
    placeholders: ['trainerName', 'dogName', 'planName', 'detail'],
    sampleValues: { trainerName: 'Jess', dogName: 'Bailey', planName: 'Puppy Foundations', detail: '6 sessions · Thursdays 6pm' },
  },
  CLIENT_SESSION_DIGEST: {
    type: 'CLIENT_SESSION_DIGEST',
    label: 'Morning summary',
    description: "A rundown of the day's sessions each morning.",
    trigger: 'time-of-day',
    audience: 'client',
    channels: ['PUSH', 'EMAIL', 'IN_APP'],
    defaultChannels: ['PUSH', 'IN_APP'],
    defaults: {
      enabled: true,
      dailyAtHour: 8,
      title: "Today's sessions",
      body: '{{summary}}',
    },
    placeholders: ['summary'],
    sampleValues: { summary: 'Puppy Foundations at 6:00 pm' },
  },
  CLIENT_SESSION_REMINDER: {
    type: 'CLIENT_SESSION_REMINDER',
    label: 'Before each session',
    description: "A heads-up before each session — pick the times and how you're reminded.",
    trigger: 'time-before-event',
    audience: 'client',
    channels: ['PUSH', 'EMAIL', 'IN_APP'],
    defaultChannels: ['PUSH', 'IN_APP'],
    defaults: {
      enabled: true,
      minutesBefore: 120,
      title: 'Upcoming session — {{dogName}}',
      body: '{{planName}} at {{startTime}}',
    },
    placeholders: ['dogName', 'planName', 'startTime'],
    sampleValues: { dogName: 'Bailey', planName: 'Puppy Foundations', startTime: '6:00 pm' },
  },
  CLIENT_SESSION_CHANGED: {
    type: 'CLIENT_SESSION_CHANGED',
    label: 'Changes & cancellations',
    description: "When a session is rescheduled or cancelled.",
    trigger: 'event',
    audience: 'client',
    channels: ['PUSH', 'EMAIL', 'IN_APP'],
    defaultChannels: ['PUSH', 'EMAIL', 'IN_APP'],
    defaults: {
      enabled: true,
      title: 'Session updated — {{dogName}}',
      body: '{{detail}}',
    },
    placeholders: ['dogName', 'planName', 'detail'],
    sampleValues: { dogName: 'Bailey', planName: 'Puppy Foundations', detail: 'Moved to Fri 13 Jun, 6:00 pm' },
  },
  CLIENT_RECAP_READY: {
    type: 'CLIENT_RECAP_READY',
    label: 'Session recaps',
    description: "When your trainer posts the write-up for a session.",
    trigger: 'event',
    audience: 'client',
    channels: ['PUSH', 'EMAIL', 'IN_APP'],
    defaultChannels: ['PUSH', 'IN_APP'],
    defaults: {
      enabled: true,
      title: 'Your recap is ready — {{dogName}}',
      body: '{{trainerName}} wrote up {{planName}}',
    },
    placeholders: ['trainerName', 'dogName', 'planName'],
    sampleValues: { trainerName: 'Jess', dogName: 'Bailey', planName: 'Tuesday session' },
  },
  CLIENT_NEW_MESSAGE: {
    type: 'CLIENT_NEW_MESSAGE',
    label: 'Messages',
    description: 'When your trainer sends you a message.',
    trigger: 'event',
    audience: 'client',
    channels: ['PUSH', 'EMAIL', 'IN_APP'],
    defaultChannels: ['PUSH', 'IN_APP'],
    defaults: {
      enabled: true,
      title: 'New message from {{senderName}}',
      body: '{{preview}}',
    },
    placeholders: ['senderName', 'preview'],
    sampleValues: { senderName: 'Jess', preview: 'See you Thursday at 6!' },
  },
}

// Substitute {{placeholder}} tokens. Unknown placeholders are left as-is
// (helps the settings UI preview surface authoring mistakes).
export function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] : `{{${key}}}`,
  )
}
