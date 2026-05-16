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
}

export const NOTIFICATION_TYPES: Record<NotificationType, NotificationTypeMeta> = {
  SESSION_REMINDER: {
    type: 'SESSION_REMINDER',
    label: 'Upcoming session',
    description: 'Heads-up that one of your sessions is starting soon.',
    trigger: 'time-before-event',
    channels: ['PUSH'],
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
    channels: ['PUSH'],
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
      body: '{{clientName}} just signed up{{#dogName}} with {{dogName}}{{/dogName}}.',
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
    channels: ['PUSH'],
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
  NEW_MESSAGE: {
    type: 'NEW_MESSAGE',
    label: 'New message',
    description: 'Someone sent you a message in the app.',
    trigger: 'event',
    channels: ['PUSH'],
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
    label: 'Streak update',
    description: 'A short daily nudge about your weekly engagement streak — keeps you in the habit and warns you before a streak lapses. Sent each morning in your timezone; copy we look after for you.',
    trigger: 'time-of-day',
    channels: ['PUSH'],
    // Locked: one curated line, fixed morning time.
    customisable: false,
    defaults: {
      enabled: true,
      dailyAtHour: 8,
      title: 'Your streak 🔥',
      body: '{{message}}',
    },
    placeholders: ['message', 'weeks'],
    sampleValues: {
      message: "5-week streak going — you've already been active this week. Nice.",
      weeks: '5',
    },
  },
}

// Substitute {{placeholder}} tokens. Unknown placeholders are left as-is
// (helps the settings UI preview surface authoring mistakes).
export function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] : `{{${key}}}`,
  )
}
