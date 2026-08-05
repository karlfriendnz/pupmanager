import {
  Bell, Dumbbell, CheckCircle2, MessageSquare, Inbox, UserPlus, Calendar, CalendarDays,
  FileText, Clock, Flame, ClipboardList, CalendarClock, CalendarX, ShoppingBag,
  Megaphone, Wallet, KeyRound, Hourglass,
  type LucideIcon,
} from 'lucide-react'

// One icon per NotificationType, shared by the realtime toast and the
// notifications feed so a given kind always reads the same. Falls back to the
// bell for anything unmapped (incl. legacy rows with a null type).
const NOTIFICATION_ICONS: Record<string, LucideIcon> = {
  // Trainer-facing
  CLIENT_LOGGED_TRAINING: Dumbbell,
  CLIENT_COMPLETED_TASKS: CheckCircle2,
  CLIENT_BOOKED_SESSION: Calendar,
  CLIENT_CANCELLED_SESSION: CalendarX,
  CLIENT_SHOP_ORDER: ShoppingBag,
  NEW_MESSAGE: MessageSquare,
  NEW_ENQUIRY: Inbox,
  ENQUIRY_FOLLOWUP_REMINDER: Clock,
  NEW_CLIENT_INVITE_ACCEPTED: UserPlus,
  SESSION_REMINDER: Calendar,
  SESSION_NOTES_REMINDER: FileText,
  DAILY_SUMMARY: Calendar,
  WEEKLY_SUMMARY: CalendarDays,
  STREAK_UPDATE: Flame,
  PLATFORM_ANNOUNCEMENT: Megaphone,
  // Somebody is stopped on a step until you do your bit — a hand up, not a bell.
  FLOW_STEP_WAITING: Hourglass,
  // Client-facing
  CLIENT_ADDED_TO_PLAN: ClipboardList,
  CLIENT_SESSION_DIGEST: Calendar,
  CLIENT_SESSION_REMINDER: Clock,
  CLIENT_SESSION_CHANGED: CalendarClock,
  CLIENT_RECAP_READY: FileText,
  CLIENT_NEW_MESSAGE: MessageSquare,
  TRAINER_COMMENTED_LOG: MessageSquare,
  // "Please pay this invoice" — the one client notification with money on the
  // end of it, and it was falling through to the generic bell.
  CLIENT_PAYMENT_REQUEST: Wallet,
  // A door opening, not a booking — an invitation says a restricted package is
  // now available to them, which is a different thing from being added to one.
  CLIENT_MEMBERSHIP_INVITE: KeyRound,
}

export function iconForNotification(type?: string | null): LucideIcon {
  return (type && NOTIFICATION_ICONS[type]) || Bell
}
