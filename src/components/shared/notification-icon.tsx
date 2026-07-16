import {
  Bell, Dumbbell, CheckCircle2, MessageSquare, Inbox, UserPlus, Calendar, CalendarDays,
  FileText, Clock, Flame, ClipboardList, CalendarClock, Trophy, type LucideIcon,
} from 'lucide-react'

// One icon per NotificationType, shared by the realtime toast and the
// notifications feed so a given kind always reads the same. Falls back to the
// bell for anything unmapped (incl. legacy rows with a null type).
const NOTIFICATION_ICONS: Record<string, LucideIcon> = {
  // Trainer-facing
  CLIENT_LOGGED_TRAINING: Dumbbell,
  CLIENT_COMPLETED_TASKS: CheckCircle2,
  NEW_MESSAGE: MessageSquare,
  NEW_ENQUIRY: Inbox,
  ENQUIRY_FOLLOWUP_REMINDER: Clock,
  NEW_CLIENT_INVITE_ACCEPTED: UserPlus,
  SESSION_REMINDER: Calendar,
  SESSION_NOTES_REMINDER: FileText,
  DAILY_SUMMARY: Calendar,
  WEEKLY_SUMMARY: CalendarDays,
  STREAK_UPDATE: Flame,
  // Client-facing
  CLIENT_ADDED_TO_PLAN: ClipboardList,
  CLIENT_SESSION_DIGEST: Calendar,
  CLIENT_SESSION_REMINDER: Clock,
  CLIENT_SESSION_CHANGED: CalendarClock,
  CLIENT_RECAP_READY: FileText,
  CLIENT_NEW_MESSAGE: MessageSquare,
  TRAINER_COMMENTED_LOG: MessageSquare,
  CLIENT_ACHIEVEMENT: Trophy,
}

export function iconForNotification(type?: string | null): LucideIcon {
  return (type && NOTIFICATION_ICONS[type]) || Bell
}
