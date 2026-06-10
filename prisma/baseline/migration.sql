-- CreateEnum
CREATE TYPE "Role" AS ENUM ('TRAINER', 'CLIENT', 'ADMIN');

-- CreateEnum
CREATE TYPE "CompanyRole" AS ENUM ('OWNER', 'MANAGER', 'STAFF');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'TRIALING', 'PAST_DUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ShareType" AS ENUM ('READ_ONLY', 'CO_MANAGE', 'TRANSFER');

-- CreateEnum
CREATE TYPE "SessionType" AS ENUM ('IN_PERSON', 'VIRTUAL');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('UPCOMING', 'COMPLETED', 'COMMENTED', 'INVOICED');

-- CreateEnum
CREATE TYPE "AttachmentKind" AS ENUM ('IMAGE', 'VIDEO');

-- CreateEnum
CREATE TYPE "MessageChannel" AS ENUM ('TRAINER_CLIENT', 'TRAINER_TRAINER');

-- CreateEnum
CREATE TYPE "CustomFieldType" AS ENUM ('TEXT', 'NUMBER', 'DROPDOWN');

-- CreateEnum
CREATE TYPE "ProductKind" AS ENUM ('PHYSICAL', 'DIGITAL');

-- CreateEnum
CREATE TYPE "ProductRequestStatus" AS ENUM ('PENDING', 'FULFILLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DevicePlatform" AS ENUM ('IOS', 'ANDROID');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('SESSION_REMINDER', 'SESSION_NOTES_REMINDER', 'NEW_CLIENT_INVITE_ACCEPTED', 'CLIENT_COMPLETED_TASKS', 'NEW_MESSAGE', 'NEW_ENQUIRY', 'ENQUIRY_FOLLOWUP_REMINDER', 'DAILY_SUMMARY', 'WEEKLY_SUMMARY', 'STREAK_UPDATE', 'CLIENT_ADDED_TO_PLAN', 'CLIENT_SESSION_DIGEST', 'CLIENT_SESSION_REMINDER', 'CLIENT_SESSION_CHANGED', 'CLIENT_RECAP_READY', 'CLIENT_NEW_MESSAGE');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('PUSH', 'EMAIL', 'IN_APP');

-- CreateEnum
CREATE TYPE "ClassRunStatus" AS ENUM ('SCHEDULED', 'RUNNING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EnrollmentType" AS ENUM ('FULL', 'DROP_IN');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('ENROLLED', 'WAITLISTED', 'WITHDRAWN', 'COMPLETED');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'LATE', 'EXCUSED', 'MAKEUP');

-- CreateEnum
CREATE TYPE "WaitlistStatus" AS ENUM ('WAITING', 'CONTACTED', 'SCHEDULED', 'REMOVED');

-- CreateEnum
CREATE TYPE "BookingRequestStatus" AS ENUM ('PENDING', 'CONFIRMED', 'DECLINED');

-- CreateEnum
CREATE TYPE "BillingItemKind" AS ENUM ('SEAT', 'ADDON');

-- CreateEnum
CREATE TYPE "AchievementTrigger" AS ENUM ('MANUAL', 'FIRST_SESSION', 'SESSIONS_COMPLETED', 'IN_PERSON_SESSIONS', 'VIRTUAL_SESSIONS', 'CONSECUTIVE_SESSIONS_ATTENDED', 'FIRST_PACKAGE_ASSIGNED', 'PACKAGES_COMPLETED', 'FIRST_HOMEWORK_DONE', 'HOMEWORK_TASKS_DONE', 'HOMEWORK_STREAK_DAYS', 'PERFECT_WEEK', 'CLIENT_ANNIVERSARY_DAYS', 'MESSAGES_SENT', 'PRODUCTS_PURCHASED', 'PROFILE_COMPLETED');

-- CreateEnum
CREATE TYPE "EnquiryStatus" AS ENUM ('NEW', 'ACCEPTED', 'DECLINED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" "Role" NOT NULL DEFAULT 'TRAINER',
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Pacific/Auckland',
    "notifyEmail" BOOLEAN NOT NULL DEFAULT true,
    "notifyPush" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "minutesBefore" INTEGER,
    "leadMinutes" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "dailyAtHour" INTEGER,
    "customTitle" TEXT,
    "customBody" TEXT,
    "dayOffSummary" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" "DevicePlatform" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_tokens" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "trainer_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "slug" TEXT,
    "phone" TEXT,
    "logoUrl" TEXT,
    "website" TEXT,
    "publicEmail" TEXT,
    "dashboardBgUrl" TEXT,
    "inviteTemplate" TEXT,
    "emailAccentColor" TEXT,
    "appGradientStart" TEXT,
    "appGradientEnd" TEXT,
    "clientWelcomeNote" TEXT,
    "googleCalendarRefreshToken" TEXT,
    "googleCalendarConnected" BOOLEAN NOT NULL DEFAULT false,
    "scheduleStartHour" INTEGER NOT NULL DEFAULT 7,
    "scheduleEndHour" INTEGER NOT NULL DEFAULT 21,
    "scheduleMobileStartHour" INTEGER,
    "scheduleMobileEndHour" INTEGER,
    "scheduleDays" JSONB NOT NULL DEFAULT '[1,2,3,4,5,6,7]',
    "scheduleExtraFields" JSONB NOT NULL DEFAULT '[]',
    "intakeSectionOrder" JSONB NOT NULL DEFAULT '[]',
    "intakeFormPublished" BOOLEAN NOT NULL DEFAULT false,
    "intakeSystemFieldSections" JSONB NOT NULL DEFAULT '{}',
    "clientListColumns" JSONB NOT NULL DEFAULT '["email","dog","nextSession","compliance"]',
    "clientListGroupBy" TEXT,
    "subscriptionPlanId" TEXT,
    "subscriptionStatus" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "trialEndsAt" TIMESTAMP(3),
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "currentPeriodEnd" TIMESTAMP(3),
    "gracePeriodUntil" TIMESTAMP(3),
    "sandboxBilling" BOOLEAN NOT NULL DEFAULT false,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "seatCount" INTEGER NOT NULL DEFAULT 1,
    "isFounder" BOOLEAN NOT NULL DEFAULT false,
    "founderClaimedAt" TIMESTAMP(3),
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "addressCity" TEXT,
    "addressRegion" TEXT,
    "addressPostcode" TEXT,
    "addressCountry" TEXT,
    "promoCodeId" TEXT,
    "baseAddress" TEXT,
    "baseLat" DOUBLE PRECISION,
    "baseLng" DOUBLE PRECISION,
    "basePlaceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trainer_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_codes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "trialDays" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "maxRedemptions" INTEGER,
    "redeemedCount" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promo_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trainer_memberships" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "CompanyRole" NOT NULL DEFAULT 'STAFF',
    "title" TEXT,
    "permissions" JSONB NOT NULL DEFAULT '{}',
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trainer_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "assignedMembershipId" TEXT,
    "dogId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "phone" TEXT,
    "addressLine" TEXT,
    "addressLat" DOUBLE PRECISION,
    "addressLng" DOUBLE PRECISION,
    "addressPlaceId" TEXT,
    "invitedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dogs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "breed" TEXT,
    "weight" DOUBLE PRECISION,
    "dob" TIMESTAMP(3),
    "photoUrl" TEXT,
    "notes" TEXT,
    "clientProfileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dogs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dog_media" (
    "id" TEXT NOT NULL,
    "dogId" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "kind" "AttachmentKind" NOT NULL,
    "url" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "caption" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dog_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_shares" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "sharedById" TEXT NOT NULL,
    "sharedWithId" TEXT NOT NULL,
    "shareType" "ShareType" NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_tasks" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "dogId" TEXT,
    "sessionId" TEXT,
    "date" DATE NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "repetitions" INTEGER,
    "videoUrl" TEXT,
    "trainerNote" TEXT,
    "imageUrls" JSONB NOT NULL DEFAULT '[]',
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_completions" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "videoUrl" TEXT,
    "videoS3Key" TEXT,

    CONSTRAINT "task_completions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_sessions" (
    "id" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "assignedMembershipId" TEXT,
    "clientId" TEXT,
    "dogId" TEXT,
    "clientPackageId" TEXT,
    "classRunId" TEXT,
    "sessionIndex" INTEGER,
    "walkSeriesId" TEXT,
    "sessionFormId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "durationMins" INTEGER NOT NULL DEFAULT 60,
    "sessionType" "SessionType" NOT NULL DEFAULT 'IN_PERSON',
    "status" "SessionStatus" NOT NULL DEFAULT 'UPCOMING',
    "invoicedAt" TIMESTAMP(3),
    "location" TEXT,
    "virtualLink" TEXT,
    "googleCalendarEventId" TEXT,
    "reminderPushSentAt" TIMESTAMP(3),
    "notesReminderPushSentAt" TIMESTAMP(3),
    "rescheduleNotifyPendingAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_attachments" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "kind" "AttachmentKind" NOT NULL,
    "url" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "caption" TEXT,
    "sizeBytes" INTEGER NOT NULL,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_buddies" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "dogId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_buddies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" "ProductKind" NOT NULL DEFAULT 'PHYSICAL',
    "priceCents" INTEGER,
    "imageUrl" TEXT,
    "downloadUrl" TEXT,
    "category" TEXT,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_requests" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "status" "ProductRequestStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "fulfilledSessionId" TEXT,
    "fulfilledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packages" (
    "id" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sessionCount" INTEGER NOT NULL DEFAULT 3,
    "weeksBetween" INTEGER NOT NULL DEFAULT 2,
    "durationMins" INTEGER NOT NULL DEFAULT 60,
    "sessionType" "SessionType" NOT NULL DEFAULT 'IN_PERSON',
    "priceCents" INTEGER,
    "specialPriceCents" INTEGER,
    "color" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "defaultSessionFormId" TEXT,
    "requireSessionNotes" BOOLEAN NOT NULL DEFAULT true,
    "isGroup" BOOLEAN NOT NULL DEFAULT false,
    "capacity" INTEGER,
    "allowDropIn" BOOLEAN NOT NULL DEFAULT false,
    "dropInPriceCents" INTEGER,
    "allowWaitlist" BOOLEAN NOT NULL DEFAULT false,
    "publicEnrollment" BOOLEAN NOT NULL DEFAULT false,
    "clientSelfBook" BOOLEAN NOT NULL DEFAULT false,
    "selfBookRequiresApproval" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_packages" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "extendIndefinitely" BOOLEAN NOT NULL DEFAULT false,
    "invoicedAt" TIMESTAMP(3),

    CONSTRAINT "client_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_runs" (
    "id" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "packageId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scheduleNote" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "capacity" INTEGER,
    "status" "ClassRunStatus" NOT NULL DEFAULT 'SCHEDULED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "class_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_enrollments" (
    "id" TEXT NOT NULL,
    "classRunId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "dogId" TEXT,
    "type" "EnrollmentType" NOT NULL DEFAULT 'FULL',
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'ENROLLED',
    "waitlistPosition" INTEGER,
    "joinedAtIndex" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'TRAINER',
    "invoicedAt" TIMESTAMP(3),
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawnAt" TIMESTAMP(3),

    CONSTRAINT "class_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_attendance" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "status" "AttendanceStatus" NOT NULL DEFAULT 'PRESENT',
    "note" TEXT,
    "scores" JSONB NOT NULL DEFAULT '{}',
    "report" JSONB,
    "markedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "session_attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waitlist_entries" (
    "id" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "clientId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "packageId" TEXT,
    "request" TEXT,
    "sessionType" "SessionType",
    "preferredDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "preferredTimeStart" TEXT,
    "preferredTimeEnd" TEXT,
    "earliestStart" DATE,
    "notes" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "status" "WaitlistStatus" NOT NULL DEFAULT 'WAITING',
    "contactedAt" TIMESTAMP(3),
    "convertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "waitlist_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_requests" (
    "id" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "dogId" TEXT,
    "sessionDates" JSONB NOT NULL DEFAULT '[]',
    "status" "BookingRequestStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "resultingClientPackageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "booking_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trainer_activity_weeks" (
    "id" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "isoWeek" TEXT NOT NULL,
    "firstActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trainer_activity_weeks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trainer_badge_awards" (
    "id" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "badgeKey" TEXT NOT NULL,
    "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trainer_badge_awards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_forms" (
    "id" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "introText" TEXT,
    "closingText" TEXT,
    "backgroundColor" TEXT,
    "backgroundUrl" TEXT,
    "questions" JSONB NOT NULL DEFAULT '[]',
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "session_forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_form_responses" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "imagesByQuestion" JSONB NOT NULL DEFAULT '{}',
    "introMessage" TEXT,
    "closingMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "session_form_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_templates" (
    "id" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_tasks" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "dayOffset" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "repetitions" INTEGER,
    "videoUrl" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "template_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "clientId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_reminders_sent" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "leadMinutes" INTEGER NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_reminders_sent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "type" "NotificationType",
    "link" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_fields" (
    "id" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "label" TEXT NOT NULL,
    "type" "CustomFieldType" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "options" JSONB,
    "order" INTEGER NOT NULL DEFAULT 0,
    "category" TEXT,
    "appliesTo" TEXT NOT NULL DEFAULT 'OWNER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_field_values" (
    "id" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "dogId" TEXT,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_field_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_plans" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priceMonthly" DOUBLE PRECISION NOT NULL,
    "maxClients" INTEGER,
    "featureFlags" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "stripePriceId" TEXT,
    "stripePriceIdsByCurrency" JSONB NOT NULL DEFAULT '{}',
    "stripePriceIdTest" TEXT,
    "stripePriceIdsByCurrencyTest" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_items" (
    "id" TEXT NOT NULL,
    "kind" "BillingItemKind" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priceMonthly" DOUBLE PRECISION NOT NULL,
    "stripePriceId" TEXT,
    "stripePriceIdsByCurrency" JSONB NOT NULL DEFAULT '{}',
    "stripePriceIdTest" TEXT,
    "stripePriceIdsByCurrencyTest" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trainer_addons" (
    "id" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "stripeSubscriptionItemId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trainer_addons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "library_types" (
    "id" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "library_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "library_themes" (
    "id" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "library_themes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "library_tasks" (
    "id" TEXT NOT NULL,
    "themeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "repetitions" INTEGER,
    "videoUrl" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "library_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_notifications" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "notes" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "availability_slots" (
    "id" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT,
    "dayOfWeek" INTEGER,
    "date" DATE,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "cadenceWeeks" INTEGER NOT NULL DEFAULT 1,
    "firstDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "availability_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blackout_periods" (
    "id" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "reason" TEXT,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blackout_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "achievements" (
    "id" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "color" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "triggerType" "AchievementTrigger" NOT NULL DEFAULT 'MANUAL',
    "triggerValue" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "achievements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_achievements" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "achievementId" TEXT NOT NULL,
    "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "awardedBy" TEXT NOT NULL,
    "earnedValue" INTEGER,

    CONSTRAINT "client_achievements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "embed_forms" (
    "id" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "fields" JSONB NOT NULL DEFAULT '[]',
    "customFieldIds" JSONB NOT NULL DEFAULT '[]',
    "thankYouTitle" TEXT,
    "thankYouMessage" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "showBorder" BOOLEAN NOT NULL DEFAULT true,
    "buttonColor" TEXT,
    "welcomeSubject" TEXT,
    "welcomeIntro" TEXT,
    "welcomeShowDiaryButton" BOOLEAN NOT NULL DEFAULT true,
    "welcomeButtonLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "embed_forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enquiries" (
    "id" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "formId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "dogName" TEXT,
    "dogBreed" TEXT,
    "dogWeight" DOUBLE PRECISION,
    "dogDob" TIMESTAMP(3),
    "message" TEXT,
    "customFieldValues" JSONB NOT NULL DEFAULT '{}',
    "status" "EnquiryStatus" NOT NULL DEFAULT 'NEW',
    "viewedAt" TIMESTAMP(3),
    "followupReminderLevel" INTEGER NOT NULL DEFAULT 0,
    "clientProfileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "enquiries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enquiry_messages" (
    "id" TEXT NOT NULL,
    "enquiryId" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'OUTBOUND',
    "subject" TEXT NOT NULL,
    "bodyText" TEXT NOT NULL,
    "sentByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enquiry_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_steps" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "ctaLabel" TEXT NOT NULL,
    "ctaHref" TEXT NOT NULL,
    "skippable" BOOLEAN NOT NULL DEFAULT true,
    "skipWarning" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onboarding_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_emails" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "topText" TEXT,
    "imageUrl" TEXT,
    "imageHeight" INTEGER,
    "senderKey" TEXT NOT NULL DEFAULT 'karl',
    "triggerRule" JSONB NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onboarding_emails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trainer_onboarding_progress" (
    "id" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ahaReachedAt" TIMESTAMP(3),
    "firstInviteSentAt" TIMESTAMP(3),
    "checklistDismissedAt" TIMESTAMP(3),
    "backfilledAt" TIMESTAMP(3),
    "welcomeShownAt" TIMESTAMP(3),
    "tourStartedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trainer_onboarding_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trainer_onboarding_step_progress" (
    "id" TEXT NOT NULL,
    "progressId" TEXT NOT NULL,
    "stepKey" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "skippedAt" TIMESTAMP(3),

    CONSTRAINT "trainer_onboarding_step_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trainer_onboarding_email_logs" (
    "id" TEXT NOT NULL,
    "progressId" TEXT NOT NULL,
    "emailKey" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trainer_onboarding_email_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limits" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "resetAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "notification_preferences_userId_idx" ON "notification_preferences"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_userId_type_channel_key" ON "notification_preferences"("userId", "type", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "device_tokens_token_key" ON "device_tokens"("token");

-- CreateIndex
CREATE INDEX "device_tokens_userId_idx" ON "device_tokens"("userId");

-- CreateIndex
CREATE INDEX "accounts_userId_idx" ON "accounts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_provider_providerAccountId_key" ON "accounts"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_sessionToken_key" ON "sessions"("sessionToken");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_token_key" ON "verification_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_identifier_token_key" ON "verification_tokens"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "trainer_profiles_userId_key" ON "trainer_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "trainer_profiles_slug_key" ON "trainer_profiles"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "trainer_profiles_stripeCustomerId_key" ON "trainer_profiles"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "trainer_profiles_stripeSubscriptionId_key" ON "trainer_profiles"("stripeSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "promo_codes_code_key" ON "promo_codes"("code");

-- CreateIndex
CREATE INDEX "trainer_memberships_companyId_idx" ON "trainer_memberships"("companyId");

-- CreateIndex
CREATE INDEX "trainer_memberships_userId_idx" ON "trainer_memberships"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "trainer_memberships_companyId_userId_key" ON "trainer_memberships"("companyId", "userId");

-- CreateIndex
CREATE INDEX "client_profiles_userId_idx" ON "client_profiles"("userId");

-- CreateIndex
CREATE INDEX "client_profiles_trainerId_idx" ON "client_profiles"("trainerId");

-- CreateIndex
CREATE INDEX "client_profiles_assignedMembershipId_idx" ON "client_profiles"("assignedMembershipId");

-- CreateIndex
CREATE UNIQUE INDEX "client_profiles_userId_trainerId_key" ON "client_profiles"("userId", "trainerId");

-- CreateIndex
CREATE INDEX "dogs_clientProfileId_idx" ON "dogs"("clientProfileId");

-- CreateIndex
CREATE INDEX "dog_media_dogId_idx" ON "dog_media"("dogId");

-- CreateIndex
CREATE INDEX "dog_media_trainerId_idx" ON "dog_media"("trainerId");

-- CreateIndex
CREATE INDEX "client_shares_clientId_idx" ON "client_shares"("clientId");

-- CreateIndex
CREATE INDEX "client_shares_sharedWithId_idx" ON "client_shares"("sharedWithId");

-- CreateIndex
CREATE INDEX "training_tasks_clientId_idx" ON "training_tasks"("clientId");

-- CreateIndex
CREATE INDEX "training_tasks_date_idx" ON "training_tasks"("date");

-- CreateIndex
CREATE INDEX "training_tasks_sessionId_idx" ON "training_tasks"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "task_completions_taskId_key" ON "task_completions"("taskId");

-- CreateIndex
CREATE INDEX "training_sessions_trainerId_idx" ON "training_sessions"("trainerId");

-- CreateIndex
CREATE INDEX "training_sessions_assignedMembershipId_idx" ON "training_sessions"("assignedMembershipId");

-- CreateIndex
CREATE INDEX "training_sessions_clientId_idx" ON "training_sessions"("clientId");

-- CreateIndex
CREATE INDEX "training_sessions_scheduledAt_idx" ON "training_sessions"("scheduledAt");

-- CreateIndex
CREATE INDEX "training_sessions_trainerId_scheduledAt_idx" ON "training_sessions"("trainerId", "scheduledAt");

-- CreateIndex
CREATE INDEX "training_sessions_clientPackageId_idx" ON "training_sessions"("clientPackageId");

-- CreateIndex
CREATE INDEX "training_sessions_classRunId_idx" ON "training_sessions"("classRunId");

-- CreateIndex
CREATE INDEX "training_sessions_walkSeriesId_idx" ON "training_sessions"("walkSeriesId");

-- CreateIndex
CREATE INDEX "session_attachments_sessionId_idx" ON "session_attachments"("sessionId");

-- CreateIndex
CREATE INDEX "session_attachments_trainerId_idx" ON "session_attachments"("trainerId");

-- CreateIndex
CREATE INDEX "session_buddies_sessionId_idx" ON "session_buddies"("sessionId");

-- CreateIndex
CREATE INDEX "session_buddies_clientId_idx" ON "session_buddies"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "session_buddies_sessionId_clientId_dogId_key" ON "session_buddies"("sessionId", "clientId", "dogId");

-- CreateIndex
CREATE INDEX "products_trainerId_idx" ON "products"("trainerId");

-- CreateIndex
CREATE INDEX "products_category_idx" ON "products"("category");

-- CreateIndex
CREATE INDEX "product_requests_clientId_status_idx" ON "product_requests"("clientId", "status");

-- CreateIndex
CREATE INDEX "product_requests_productId_idx" ON "product_requests"("productId");

-- CreateIndex
CREATE INDEX "packages_trainerId_idx" ON "packages"("trainerId");

-- CreateIndex
CREATE INDEX "packages_defaultSessionFormId_idx" ON "packages"("defaultSessionFormId");

-- CreateIndex
CREATE INDEX "client_packages_clientId_idx" ON "client_packages"("clientId");

-- CreateIndex
CREATE INDEX "client_packages_packageId_idx" ON "client_packages"("packageId");

-- CreateIndex
CREATE INDEX "class_runs_trainerId_idx" ON "class_runs"("trainerId");

-- CreateIndex
CREATE INDEX "class_runs_packageId_idx" ON "class_runs"("packageId");

-- CreateIndex
CREATE INDEX "class_enrollments_classRunId_idx" ON "class_enrollments"("classRunId");

-- CreateIndex
CREATE INDEX "class_enrollments_clientId_idx" ON "class_enrollments"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "class_enrollments_classRunId_clientId_dogId_key" ON "class_enrollments"("classRunId", "clientId", "dogId");

-- CreateIndex
CREATE INDEX "session_attendance_sessionId_idx" ON "session_attendance"("sessionId");

-- CreateIndex
CREATE INDEX "session_attendance_enrollmentId_idx" ON "session_attendance"("enrollmentId");

-- CreateIndex
CREATE UNIQUE INDEX "session_attendance_sessionId_enrollmentId_key" ON "session_attendance"("sessionId", "enrollmentId");

-- CreateIndex
CREATE INDEX "waitlist_entries_trainerId_status_idx" ON "waitlist_entries"("trainerId", "status");

-- CreateIndex
CREATE INDEX "waitlist_entries_clientId_idx" ON "waitlist_entries"("clientId");

-- CreateIndex
CREATE INDEX "waitlist_entries_packageId_idx" ON "waitlist_entries"("packageId");

-- CreateIndex
CREATE INDEX "booking_requests_trainerId_status_idx" ON "booking_requests"("trainerId", "status");

-- CreateIndex
CREATE INDEX "booking_requests_clientId_idx" ON "booking_requests"("clientId");

-- CreateIndex
CREATE INDEX "trainer_activity_weeks_trainerId_idx" ON "trainer_activity_weeks"("trainerId");

-- CreateIndex
CREATE UNIQUE INDEX "trainer_activity_weeks_trainerId_isoWeek_key" ON "trainer_activity_weeks"("trainerId", "isoWeek");

-- CreateIndex
CREATE INDEX "trainer_badge_awards_trainerId_idx" ON "trainer_badge_awards"("trainerId");

-- CreateIndex
CREATE UNIQUE INDEX "trainer_badge_awards_trainerId_badgeKey_key" ON "trainer_badge_awards"("trainerId", "badgeKey");

-- CreateIndex
CREATE INDEX "session_forms_trainerId_idx" ON "session_forms"("trainerId");

-- CreateIndex
CREATE INDEX "session_form_responses_sessionId_idx" ON "session_form_responses"("sessionId");

-- CreateIndex
CREATE INDEX "session_form_responses_formId_idx" ON "session_form_responses"("formId");

-- CreateIndex
CREATE UNIQUE INDEX "session_form_responses_sessionId_formId_key" ON "session_form_responses"("sessionId", "formId");

-- CreateIndex
CREATE INDEX "messages_clientId_idx" ON "messages"("clientId");

-- CreateIndex
CREATE INDEX "messages_senderId_idx" ON "messages"("senderId");

-- CreateIndex
CREATE INDEX "messages_createdAt_idx" ON "messages"("createdAt");

-- CreateIndex
CREATE INDEX "client_reminders_sent_sessionId_idx" ON "client_reminders_sent"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "client_reminders_sent_sessionId_userId_leadMinutes_key" ON "client_reminders_sent"("sessionId", "userId", "leadMinutes");

-- CreateIndex
CREATE INDEX "notifications_userId_idx" ON "notifications"("userId");

-- CreateIndex
CREATE INDEX "custom_fields_trainerId_idx" ON "custom_fields"("trainerId");

-- CreateIndex
CREATE INDEX "custom_field_values_clientId_idx" ON "custom_field_values"("clientId");

-- CreateIndex
CREATE INDEX "custom_field_values_fieldId_clientId_dogId_idx" ON "custom_field_values"("fieldId", "clientId", "dogId");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_plans_stripePriceId_key" ON "subscription_plans"("stripePriceId");

-- CreateIndex
CREATE UNIQUE INDEX "billing_items_stripePriceId_key" ON "billing_items"("stripePriceId");

-- CreateIndex
CREATE UNIQUE INDEX "trainer_addons_stripeSubscriptionItemId_key" ON "trainer_addons"("stripeSubscriptionItemId");

-- CreateIndex
CREATE INDEX "trainer_addons_trainerId_idx" ON "trainer_addons"("trainerId");

-- CreateIndex
CREATE UNIQUE INDEX "trainer_addons_trainerId_itemId_key" ON "trainer_addons"("trainerId", "itemId");

-- CreateIndex
CREATE INDEX "library_types_trainerId_idx" ON "library_types"("trainerId");

-- CreateIndex
CREATE INDEX "library_themes_typeId_idx" ON "library_themes"("typeId");

-- CreateIndex
CREATE INDEX "library_tasks_themeId_idx" ON "library_tasks"("themeId");

-- CreateIndex
CREATE INDEX "client_notifications_clientId_idx" ON "client_notifications"("clientId");

-- CreateIndex
CREATE INDEX "availability_slots_trainerId_idx" ON "availability_slots"("trainerId");

-- CreateIndex
CREATE INDEX "blackout_periods_trainerId_idx" ON "blackout_periods"("trainerId");

-- CreateIndex
CREATE INDEX "achievements_trainerId_idx" ON "achievements"("trainerId");

-- CreateIndex
CREATE INDEX "client_achievements_clientId_idx" ON "client_achievements"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "client_achievements_clientId_achievementId_key" ON "client_achievements"("clientId", "achievementId");

-- CreateIndex
CREATE INDEX "embed_forms_trainerId_idx" ON "embed_forms"("trainerId");

-- CreateIndex
CREATE UNIQUE INDEX "enquiries_clientProfileId_key" ON "enquiries"("clientProfileId");

-- CreateIndex
CREATE INDEX "enquiries_trainerId_status_idx" ON "enquiries"("trainerId", "status");

-- CreateIndex
CREATE INDEX "enquiries_trainerId_createdAt_idx" ON "enquiries"("trainerId", "createdAt");

-- CreateIndex
CREATE INDEX "enquiry_messages_enquiryId_createdAt_idx" ON "enquiry_messages"("enquiryId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_steps_key_key" ON "onboarding_steps"("key");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_emails_key_key" ON "onboarding_emails"("key");

-- CreateIndex
CREATE UNIQUE INDEX "trainer_onboarding_progress_trainerId_key" ON "trainer_onboarding_progress"("trainerId");

-- CreateIndex
CREATE INDEX "trainer_onboarding_step_progress_progressId_idx" ON "trainer_onboarding_step_progress"("progressId");

-- CreateIndex
CREATE UNIQUE INDEX "trainer_onboarding_step_progress_progressId_stepKey_key" ON "trainer_onboarding_step_progress"("progressId", "stepKey");

-- CreateIndex
CREATE INDEX "trainer_onboarding_email_logs_progressId_idx" ON "trainer_onboarding_email_logs"("progressId");

-- CreateIndex
CREATE UNIQUE INDEX "trainer_onboarding_email_logs_progressId_emailKey_key" ON "trainer_onboarding_email_logs"("progressId", "emailKey");

-- CreateIndex
CREATE INDEX "rate_limits_resetAt_idx" ON "rate_limits"("resetAt");

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainer_profiles" ADD CONSTRAINT "trainer_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainer_profiles" ADD CONSTRAINT "trainer_profiles_subscriptionPlanId_fkey" FOREIGN KEY ("subscriptionPlanId") REFERENCES "subscription_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainer_profiles" ADD CONSTRAINT "trainer_profiles_promoCodeId_fkey" FOREIGN KEY ("promoCodeId") REFERENCES "promo_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainer_memberships" ADD CONSTRAINT "trainer_memberships_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "trainer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainer_memberships" ADD CONSTRAINT "trainer_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_profiles" ADD CONSTRAINT "client_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_profiles" ADD CONSTRAINT "client_profiles_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "trainer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_profiles" ADD CONSTRAINT "client_profiles_assignedMembershipId_fkey" FOREIGN KEY ("assignedMembershipId") REFERENCES "trainer_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_profiles" ADD CONSTRAINT "client_profiles_dogId_fkey" FOREIGN KEY ("dogId") REFERENCES "dogs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dogs" ADD CONSTRAINT "dogs_clientProfileId_fkey" FOREIGN KEY ("clientProfileId") REFERENCES "client_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dog_media" ADD CONSTRAINT "dog_media_dogId_fkey" FOREIGN KEY ("dogId") REFERENCES "dogs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_shares" ADD CONSTRAINT "client_shares_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "client_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_shares" ADD CONSTRAINT "client_shares_sharedById_fkey" FOREIGN KEY ("sharedById") REFERENCES "trainer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_shares" ADD CONSTRAINT "client_shares_sharedWithId_fkey" FOREIGN KEY ("sharedWithId") REFERENCES "trainer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_tasks" ADD CONSTRAINT "training_tasks_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "client_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_tasks" ADD CONSTRAINT "training_tasks_dogId_fkey" FOREIGN KEY ("dogId") REFERENCES "dogs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_tasks" ADD CONSTRAINT "training_tasks_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "training_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_completions" ADD CONSTRAINT "task_completions_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "training_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "trainer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_assignedMembershipId_fkey" FOREIGN KEY ("assignedMembershipId") REFERENCES "trainer_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "client_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_dogId_fkey" FOREIGN KEY ("dogId") REFERENCES "dogs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_clientPackageId_fkey" FOREIGN KEY ("clientPackageId") REFERENCES "client_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_classRunId_fkey" FOREIGN KEY ("classRunId") REFERENCES "class_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_attachments" ADD CONSTRAINT "session_attachments_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "training_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_buddies" ADD CONSTRAINT "session_buddies_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "training_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_buddies" ADD CONSTRAINT "session_buddies_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "client_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_buddies" ADD CONSTRAINT "session_buddies_dogId_fkey" FOREIGN KEY ("dogId") REFERENCES "dogs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "trainer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_requests" ADD CONSTRAINT "product_requests_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "client_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_requests" ADD CONSTRAINT "product_requests_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_requests" ADD CONSTRAINT "product_requests_fulfilledSessionId_fkey" FOREIGN KEY ("fulfilledSessionId") REFERENCES "training_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packages" ADD CONSTRAINT "packages_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "trainer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packages" ADD CONSTRAINT "packages_defaultSessionFormId_fkey" FOREIGN KEY ("defaultSessionFormId") REFERENCES "session_forms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_packages" ADD CONSTRAINT "client_packages_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_packages" ADD CONSTRAINT "client_packages_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "client_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_runs" ADD CONSTRAINT "class_runs_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "trainer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_runs" ADD CONSTRAINT "class_runs_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_enrollments" ADD CONSTRAINT "class_enrollments_classRunId_fkey" FOREIGN KEY ("classRunId") REFERENCES "class_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_enrollments" ADD CONSTRAINT "class_enrollments_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "client_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_enrollments" ADD CONSTRAINT "class_enrollments_dogId_fkey" FOREIGN KEY ("dogId") REFERENCES "dogs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_attendance" ADD CONSTRAINT "session_attendance_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "training_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_attendance" ADD CONSTRAINT "session_attendance_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "class_enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "trainer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "client_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_requests" ADD CONSTRAINT "booking_requests_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "trainer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_requests" ADD CONSTRAINT "booking_requests_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "client_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_requests" ADD CONSTRAINT "booking_requests_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainer_activity_weeks" ADD CONSTRAINT "trainer_activity_weeks_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "trainer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainer_badge_awards" ADD CONSTRAINT "trainer_badge_awards_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "trainer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_forms" ADD CONSTRAINT "session_forms_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "trainer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_form_responses" ADD CONSTRAINT "session_form_responses_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "training_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_form_responses" ADD CONSTRAINT "session_form_responses_formId_fkey" FOREIGN KEY ("formId") REFERENCES "session_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_templates" ADD CONSTRAINT "training_templates_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "trainer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_tasks" ADD CONSTRAINT "template_tasks_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "training_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "client_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_fields" ADD CONSTRAINT "custom_fields_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "trainer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "custom_fields"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "client_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainer_addons" ADD CONSTRAINT "trainer_addons_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "trainer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainer_addons" ADD CONSTRAINT "trainer_addons_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "billing_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_types" ADD CONSTRAINT "library_types_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "trainer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_themes" ADD CONSTRAINT "library_themes_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "library_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_tasks" ADD CONSTRAINT "library_tasks_themeId_fkey" FOREIGN KEY ("themeId") REFERENCES "library_themes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_notifications" ADD CONSTRAINT "client_notifications_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "client_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_notifications" ADD CONSTRAINT "client_notifications_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "trainer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_slots" ADD CONSTRAINT "availability_slots_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "trainer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blackout_periods" ADD CONSTRAINT "blackout_periods_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "trainer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "achievements" ADD CONSTRAINT "achievements_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "trainer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_achievements" ADD CONSTRAINT "client_achievements_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "client_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_achievements" ADD CONSTRAINT "client_achievements_achievementId_fkey" FOREIGN KEY ("achievementId") REFERENCES "achievements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "embed_forms" ADD CONSTRAINT "embed_forms_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "trainer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "trainer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_formId_fkey" FOREIGN KEY ("formId") REFERENCES "embed_forms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_clientProfileId_fkey" FOREIGN KEY ("clientProfileId") REFERENCES "client_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enquiry_messages" ADD CONSTRAINT "enquiry_messages_enquiryId_fkey" FOREIGN KEY ("enquiryId") REFERENCES "enquiries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainer_onboarding_progress" ADD CONSTRAINT "trainer_onboarding_progress_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "trainer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainer_onboarding_step_progress" ADD CONSTRAINT "trainer_onboarding_step_progress_progressId_fkey" FOREIGN KEY ("progressId") REFERENCES "trainer_onboarding_progress"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainer_onboarding_email_logs" ADD CONSTRAINT "trainer_onboarding_email_logs_progressId_fkey" FOREIGN KEY ("progressId") REFERENCES "trainer_onboarding_progress"("id") ON DELETE CASCADE ON UPDATE CASCADE;

