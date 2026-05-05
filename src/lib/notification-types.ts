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
    description: 'A quick rundown of your sessions and tasks for the day.',
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
  NEW_MESSAGE: {
    type: 'NEW_MESSAGE',
    label: 'New message',
    description: 'A client sent you a message.',
    trigger: 'event',
    channels: ['PUSH'],
    defaults: {
      enabled: true,
      title: 'Message from {{clientName}}',
      body: '{{preview}}',
    },
    placeholders: ['clientName', 'preview'],
    sampleValues: {
      clientName: 'Grace Wilshaw',
      preview: 'Hi! Just wondering about Tilly\'s next session…',
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
