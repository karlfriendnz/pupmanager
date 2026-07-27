-- Group messaging: a group is its own THREAD that sits beside the 1:1 client
-- threads, with two modes — BROADCAST (replies are private to the trainer's
-- team) and COMMUNITY (everyone sees everyone).
--
-- These are separate tables on purpose. `messages` keeps its single `readAt`
-- column, which only works because a 1:1 message has exactly one reader; a
-- group has N, so groups carry a per-participant read watermark instead.
-- Nothing here touches `messages`.
--
-- Table names are the @@map snake_case ones (message_groups,
-- message_group_participants, group_messages, trainer_profiles, class_runs,
-- users, client_profiles). Prisma MODEL names would fail 42P01 under
-- `migrate deploy` and take the whole production build down.

-- CreateEnum
CREATE TYPE "MessageGroupMode" AS ENUM ('BROADCAST', 'COMMUNITY');
CREATE TYPE "MessageGroupScope" AS ENUM ('MANUAL', 'ALL_CLIENTS', 'CLASS_RUN', 'PACKAGE', 'MEMBERSHIP');
CREATE TYPE "MessageGroupRole" AS ENUM ('OWNER', 'STAFF', 'CLIENT');
CREATE TYPE "GroupMessageVisibility" AS ENUM ('EVERYONE', 'TRAINER_ONLY');

-- CreateTable
CREATE TABLE "message_groups" (
    "id" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mode" "MessageGroupMode" NOT NULL,
    "scope" "MessageGroupScope" NOT NULL,
    "classRunId" TEXT,
    "packageId" TEXT,
    "membershipId" TEXT,
    "includeWaitlist" BOOLEAN NOT NULL DEFAULT false,
    "important" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "lastMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_group_participants" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientProfileId" TEXT,
    "role" "MessageGroupRole" NOT NULL,
    "displayName" TEXT NOT NULL,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "joinedAt" TIMESTAMP(3),
    "leftAt" TIMESTAMP(3),
    "optedOutAt" TIMESTAMP(3),
    "lastReadAt" TIMESTAMP(3),
    "mutedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_group_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_messages" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "bodyHtml" TEXT,
    "visibility" "GroupMessageVisibility" NOT NULL DEFAULT 'EVERYONE',
    "replyToId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "message_groups_trainerId_lastMessageAt_idx" ON "message_groups"("trainerId", "lastMessageAt");
CREATE INDEX "message_group_participants_groupId_idx" ON "message_group_participants"("groupId");
CREATE INDEX "message_group_participants_userId_idx" ON "message_group_participants"("userId");
CREATE INDEX "message_group_participants_clientProfileId_idx" ON "message_group_participants"("clientProfileId");
-- One membership per person per group. Deliberately on the PAIR: the same
-- person belongs to many groups, so nothing may narrow this to userId.
CREATE UNIQUE INDEX "message_group_participants_groupId_userId_key" ON "message_group_participants"("groupId", "userId");
CREATE INDEX "group_messages_groupId_createdAt_idx" ON "group_messages"("groupId", "createdAt");
CREATE INDEX "group_messages_senderId_idx" ON "group_messages"("senderId");
-- The responses view: every reply to one broadcast, by person.
CREATE INDEX "group_messages_replyToId_idx" ON "group_messages"("replyToId");

-- AddForeignKey
ALTER TABLE "message_groups" ADD CONSTRAINT "message_groups_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "trainer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "message_groups" ADD CONSTRAINT "message_groups_classRunId_fkey" FOREIGN KEY ("classRunId") REFERENCES "class_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "message_group_participants" ADD CONSTRAINT "message_group_participants_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "message_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "message_group_participants" ADD CONSTRAINT "message_group_participants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "message_group_participants" ADD CONSTRAINT "message_group_participants_clientProfileId_fkey" FOREIGN KEY ("clientProfileId") REFERENCES "client_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "group_messages" ADD CONSTRAINT "group_messages_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "message_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "group_messages" ADD CONSTRAINT "group_messages_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "group_messages" ADD CONSTRAINT "group_messages_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "group_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
