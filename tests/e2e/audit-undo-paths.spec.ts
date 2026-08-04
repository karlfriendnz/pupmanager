/**
 * UNDO-PATH AUDIT — the low-risk DELETEs, asked the same two questions.
 *
 * The 2026-08-04 audits found ONE bug five times: an undo that undid less than
 * the action did (C-3, T-3, T-5, T-6, T-7). The ratchet in
 * tests/unit/undo-paths-have-tests.test.ts listed 49 DELETE routes with no test
 * naming them. This file takes the low-risk end of that list — a photo, a
 * to-do, a chat post, an admin note — and asks each one:
 *
 *   1. Does the undo undo everything the matching create did?
 *   2. Does the delete cascade into something that must not be destroyed —
 *      something a client filled in, paid for, or a record of what happened?
 *
 * Plus the tenant guard: business B must not be able to delete business A's row.
 *
 * Routes covered here (named literally so the ratchet can see them):
 *
 *   /admin/announcements/[id]
 *   /admin/onboarding-emails/[id]/image
 *   /admin/promo-codes/[codeId]
 *   /admin/trainer-notes/[id]
 *   /admin/trainer-tasks/[id]
 *   /admin/trainers/[trainerId]
 *   /devices/register
 *   /dogs/[dogId]/media/[mediaId]
 *   /dogs/[dogId]/photo
 *   /message-groups/[groupId]/messages/[messageId]
 *   /message-groups/[groupId]/participants/[participantId]
 *   /review/comments/[id]
 *   /schedule/[sessionId]/buddies/[buddyId]
 *   /schedule/notify-reschedules
 *   /sessions/[sessionId]/attachments/[attachmentId]
 *   /system-emails
 *   /tags/[tagId]
 *   /todos/[todoId]
 *   /trainer/class-runs/[runId]/comms-flow/[stepId]
 *   /trainer/comms-flow-templates/[templateId]
 *   /trainer/lead-magnets/[id]
 *   /trainer/memberships/[id]/comms-flow/[stepId]
 *   /trainer/memberships/[id]/invites
 */
import { test, expect, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'
import bcrypt from 'bcryptjs'
import { SEED, TEST_DATABASE_URL } from './test-db'

/* eslint-disable @typescript-eslint/no-explicit-any */

async function makePrisma(): Promise<any> {
  const { PrismaClient } = await import('../../src/generated/prisma/index.js')
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }) })
}

async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 30_000 })
}

const asOwner = (page: Page) => login(page, SEED.owner.email, SEED.owner.password)
const asAdmin = (page: Page) => login(page, SEED.admin.email, SEED.admin.password)
const asRival = (page: Page) => login(page, SEED.businessB.ownerEmail, SEED.businessB.ownerPassword)

async function ownerProfile(prisma: any) {
  return prisma.trainerProfile.findFirstOrThrow({ where: { user: { email: SEED.owner.email } } })
}

const tagFor = (s: string) => `${s}-${Date.now().toString(36)}`

/** A throwaway trainer business, torn down by the caller. */
async function makeTrainer(prisma: any, tag: string) {
  const hash = await bcrypt.hash('AuditPass123!', 12)
  const user = await prisma.user.create({
    data: {
      email: `undo-${tag}@e2e.test`, name: `Undo Trainer ${tag}`, role: 'TRAINER',
      emailVerified: new Date(),
      accounts: { create: { type: 'credentials', provider: 'credentials', providerAccountId: hash } },
    },
  })
  const profile = await prisma.trainerProfile.create({
    data: { userId: user.id, businessName: `Undo Co ${tag}`, slug: `undo-co-${tag}`, phone: '+6421000777' },
  })
  await prisma.trainerMembership.create({
    data: { companyId: profile.id, userId: user.id, role: 'OWNER', acceptedAt: new Date() },
  })
  return { userId: user.id, profileId: profile.id }
}

async function dropTrainer(prisma: any, t: { userId: string } | null) {
  if (!t) return
  await prisma.user.deleteMany({ where: { id: t.userId } }).catch(() => {})
}

// ─── /admin/announcements/[id] ────────────────────────────────────────────────

test('a SENT announcement is history and refuses to be deleted; a draft goes', async ({ page }) => {
  // Sending an announcement writes a bell card onto every trainer's feed and
  // (optionally) emails them. Nothing can take that back, so the row that says
  // what was said must survive — the DELETE is only ever for a draft.
  const prisma = await makePrisma()
  const tag = tagFor('ann')
  let draftId = ''
  let sentId = ''
  try {
    const draft = await prisma.announcement.create({
      data: { title: `Undo draft ${tag}`, body: 'Not sent yet', status: 'DRAFT' },
    })
    draftId = draft.id
    const sent = await prisma.announcement.create({
      data: {
        title: `Undo sent ${tag}`, body: 'Already on every bell', status: 'SENT',
        sentAt: new Date(), recipientCount: 12,
      },
    })
    sentId = sent.id

    // A trainer is not an admin — neither row is theirs to touch.
    await asOwner(page)
    expect((await page.request.delete(`/api/admin/announcements/${draftId}`)).status()).toBe(401)
    expect(await prisma.announcement.count({ where: { id: draftId } })).toBe(1)

    await asAdmin(page)
    const refused = await page.request.delete(`/api/admin/announcements/${sentId}`)
    expect(refused.status(), 'a sent announcement is a record of what went out').toBe(409)
    expect(await prisma.announcement.count({ where: { id: sentId } })).toBe(1)

    const gone = await page.request.delete(`/api/admin/announcements/${draftId}`)
    expect(gone.status(), await gone.text()).toBe(200)
    expect(await prisma.announcement.count({ where: { id: draftId } })).toBe(0)
    draftId = ''
  } finally {
    await prisma.announcement.deleteMany({ where: { title: { contains: tag } } }).catch(() => {})
    await prisma.$disconnect()
  }
})

// ─── /admin/trainer-notes/[id] and /admin/trainer-tasks/[id] ──────────────────

test('deleting one admin note or task leaves the others — and the business — alone', async ({ page }) => {
  const prisma = await makePrisma()
  const tag = tagFor('note')
  let trainer: { userId: string; profileId: string } | null = null
  try {
    trainer = await makeTrainer(prisma, tag)
    const keepNote = await prisma.adminTrainerNote.create({
      data: { trainerId: trainer.profileId, body: `keep ${tag}` },
    })
    const dropNote = await prisma.adminTrainerNote.create({
      data: { trainerId: trainer.profileId, body: `drop ${tag}` },
    })
    const keepTask = await prisma.adminTrainerTask.create({
      data: { trainerId: trainer.profileId, title: `keep ${tag}` },
    })
    const dropTask = await prisma.adminTrainerTask.create({
      data: { trainerId: trainer.profileId, title: `drop ${tag}` },
    })

    // A trainer must not be able to read or rub out the platform's own diary.
    await asOwner(page)
    expect((await page.request.delete(`/api/admin/trainer-notes/${dropNote.id}`)).status()).toBe(401)
    expect((await page.request.delete(`/api/admin/trainer-tasks/${dropTask.id}`)).status()).toBe(401)
    expect(await prisma.adminTrainerNote.count({ where: { id: dropNote.id } })).toBe(1)
    expect(await prisma.adminTrainerTask.count({ where: { id: dropTask.id } })).toBe(1)

    await asAdmin(page)
    expect((await page.request.delete(`/api/admin/trainer-notes/${dropNote.id}`)).status()).toBe(200)
    expect((await page.request.delete(`/api/admin/trainer-tasks/${dropTask.id}`)).status()).toBe(200)

    expect(await prisma.adminTrainerNote.count({ where: { id: dropNote.id } })).toBe(0)
    expect(await prisma.adminTrainerTask.count({ where: { id: dropTask.id } })).toBe(0)
    // Only the one asked for.
    expect(await prisma.adminTrainerNote.count({ where: { id: keepNote.id } })).toBe(1)
    expect(await prisma.adminTrainerTask.count({ where: { id: keepTask.id } })).toBe(1)
    // And the business the note was ABOUT is untouched.
    expect(await prisma.trainerProfile.count({ where: { id: trainer.profileId } })).toBe(1)
  } finally {
    if (trainer) {
      await prisma.adminTrainerNote.deleteMany({ where: { trainerId: trainer.profileId } }).catch(() => {})
      await prisma.adminTrainerTask.deleteMany({ where: { trainerId: trainer.profileId } }).catch(() => {})
    }
    await dropTrainer(prisma, trainer)
    await prisma.$disconnect()
  }
})

// ─── /admin/promo-codes/[codeId] ──────────────────────────────────────────────

test('deleting a promo code does not take away the trial anybody redeemed with it', async ({ page }) => {
  // The FK is ON DELETE SET NULL by design: a code is attribution, and removing
  // the label must never reach through to somebody's account.
  const prisma = await makePrisma()
  const tag = tagFor('promo')
  let trainer: { userId: string; profileId: string } | null = null
  let codeId = ''
  try {
    const code = await prisma.promoCode.create({
      data: { code: `UNDO${tag.toUpperCase().replace(/[^A-Z0-9]/g, '')}`, trialDays: 45, redeemedCount: 1 },
    })
    codeId = code.id
    trainer = await makeTrainer(prisma, tag)
    const trialEndsAt = new Date(Date.now() + 45 * 864e5)
    await prisma.trainerProfile.update({
      where: { id: trainer.profileId },
      data: { promoCodeId: code.id, trialEndsAt, subscriptionStatus: 'TRIALING' },
    })

    await asOwner(page)
    expect((await page.request.delete(`/api/admin/promo-codes/${codeId}`)).status()).toBe(401)
    expect(await prisma.promoCode.count({ where: { id: codeId } })).toBe(1)

    await asAdmin(page)
    const gone = await page.request.delete(`/api/admin/promo-codes/${codeId}`)
    expect(gone.status(), await gone.text()).toBe(200)
    expect(await prisma.promoCode.count({ where: { id: codeId } })).toBe(0)
    codeId = ''

    const after = await prisma.trainerProfile.findUniqueOrThrow({ where: { id: trainer.profileId } })
    expect(after.promoCodeId, 'the attribution detaches').toBeNull()
    expect(after.trialEndsAt?.getTime(), 'and the trial it granted stays granted').toBe(trialEndsAt.getTime())
    expect(after.subscriptionStatus).toBe('TRIALING')
  } finally {
    if (codeId) await prisma.promoCode.deleteMany({ where: { id: codeId } }).catch(() => {})
    await dropTrainer(prisma, trainer)
    await prisma.$disconnect()
  }
})

// ─── /admin/trainers/[trainerId] ──────────────────────────────────────────────

test('a trainer account can only be destroyed after deactivation, and a shared client survives it', async ({ page }) => {
  // The heaviest delete in the app. Two things have to hold: it refuses until
  // the account has been soft-deleted first, and a client who ALSO belongs to
  // another trainer keeps their login and that other relationship.
  test.setTimeout(180_000)
  const prisma = await makePrisma()
  const tag = tagFor('acct')
  let trainer: { userId: string; profileId: string } | null = null
  let sharedUserId = ''
  let ownerSideClientId = ''
  try {
    const owner = await ownerProfile(prisma)
    trainer = await makeTrainer(prisma, tag)

    // One dog owner, on both businesses (the Scenario-B model: one client, many
    // trainers — ClientProfile is keyed (userId, trainerId)).
    const clientUser = await prisma.user.create({
      data: { email: `undo-shared-${tag}@e2e.test`, name: `Shared Owner ${tag}`, role: 'CLIENT', emailVerified: new Date() },
    })
    sharedUserId = clientUser.id
    await prisma.clientProfile.create({
      data: { userId: clientUser.id, trainerId: trainer.profileId, status: 'ACTIVE' },
    })
    const onOwner = await prisma.clientProfile.create({
      data: { userId: clientUser.id, trainerId: owner.id, status: 'ACTIVE' },
    })
    ownerSideClientId = onOwner.id

    await asAdmin(page)

    // Still active — permanent removal must not be one click away.
    const refused = await page.request.delete(`/api/admin/trainers/${trainer.userId}`)
    expect(refused.status(), 'deactivate first, then confirm hard removal').toBe(409)
    expect(await prisma.user.count({ where: { id: trainer.userId } })).toBe(1)

    await prisma.user.update({ where: { id: trainer.userId }, data: { deactivatedAt: new Date() } })
    const gone = await page.request.delete(`/api/admin/trainers/${trainer.userId}`)
    expect(gone.status(), await gone.text()).toBe(200)
    expect(await prisma.user.count({ where: { id: trainer.userId } })).toBe(0)
    expect(await prisma.trainerProfile.count({ where: { id: trainer.profileId } })).toBe(0)
    trainer = null

    // The dog owner is somebody else's client too — deleting one business must
    // not delete the person.
    expect(await prisma.user.count({ where: { id: sharedUserId } }), 'the client keeps their login').toBe(1)
    expect(
      await prisma.clientProfile.count({ where: { id: ownerSideClientId } }),
      'and their relationship with the other trainer',
    ).toBe(1)
  } finally {
    if (ownerSideClientId) await prisma.clientProfile.deleteMany({ where: { id: ownerSideClientId } }).catch(() => {})
    if (sharedUserId) await prisma.user.deleteMany({ where: { id: sharedUserId } }).catch(() => {})
    await dropTrainer(prisma, trainer)
    await prisma.$disconnect()
  }
})

// ─── /admin/onboarding-emails/[id]/image ──────────────────────────────────────

test('clearing one onboarding-email image slot does not clear the other', async ({ page }) => {
  // POST writes to imageUrl or imageUrl2 depending on ?slot. If DELETE didn't
  // read the same parameter it would wipe the wrong picture — the plainest
  // possible version of "the undo has to match the do".
  const prisma = await makePrisma()
  const tag = tagFor('onbimg')
  let emailId = ''
  try {
    const row = await prisma.onboardingEmail.create({
      data: {
        key: `undo_${tag}`, subject: 'Subject', body: 'Body',
        triggerRule: { type: 'on_signup' },
        imageUrl: 'https://blob.test/one.png', imageUrl2: 'https://blob.test/two.png',
      },
    })
    emailId = row.id

    await asOwner(page)
    expect((await page.request.delete(`/api/admin/onboarding-emails/${emailId}/image`)).status()).toBe(401)
    expect((await prisma.onboardingEmail.findUniqueOrThrow({ where: { id: emailId } })).imageUrl).not.toBeNull()

    await asAdmin(page)
    expect((await page.request.delete(`/api/admin/onboarding-emails/${emailId}/image?slot=2`)).status()).toBe(200)
    let after = await prisma.onboardingEmail.findUniqueOrThrow({ where: { id: emailId } })
    expect(after.imageUrl2, 'slot 2 cleared').toBeNull()
    expect(after.imageUrl, 'slot 1 untouched').toBe('https://blob.test/one.png')

    expect((await page.request.delete(`/api/admin/onboarding-emails/${emailId}/image`)).status()).toBe(200)
    after = await prisma.onboardingEmail.findUniqueOrThrow({ where: { id: emailId } })
    expect(after.imageUrl).toBeNull()
    // The email itself is not the image.
    expect(after.subject).toBe('Subject')
  } finally {
    if (emailId) await prisma.onboardingEmail.deleteMany({ where: { id: emailId } }).catch(() => {})
    await prisma.$disconnect()
  }
})

// ─── /devices/register ────────────────────────────────────────────────────────

test('signing out deregisters this device and leaves the account s other devices alone', async ({ page }) => {
  const prisma = await makePrisma()
  const tag = tagFor('dev')
  const phone = `undo-phone-${tag}`
  const tablet = `undo-tablet-${tag}`
  try {
    await asOwner(page)
    const ownerUser = await prisma.user.findFirstOrThrow({ where: { email: SEED.owner.email } })

    for (const [token, platform] of [[phone, 'IOS'], [tablet, 'ANDROID']] as const) {
      const res = await page.request.post('/api/devices/register', { data: { token, platform } })
      expect(res.status(), await res.text()).toBe(200)
    }
    expect(await prisma.deviceToken.count({ where: { userId: ownerUser.id, token: { in: [phone, tablet] } } })).toBe(2)

    const out = await page.request.delete('/api/devices/register', { data: { token: phone } })
    expect(out.status(), await out.text()).toBe(200)
    expect(await prisma.deviceToken.count({ where: { token: phone } }), 'this device only').toBe(0)
    expect(await prisma.deviceToken.count({ where: { token: tablet } }), 'the other one still gets pushes').toBe(1)
  } finally {
    await prisma.deviceToken.deleteMany({ where: { token: { in: [phone, tablet] } } }).catch(() => {})
    await prisma.$disconnect()
  }
})

test('one account cannot deregister another account s device', async ({ page }) => {
  // T-13, fixed 2026-08-05. The deleteMany had no userId scope, so any signed-in
  // user holding someone else's device token could silence every push they get.
  // The POST binds a token to its caller; the DELETE is scoped the same way now.
  const prisma = await makePrisma()
  const tag = tagFor('devx')
  const token = `undo-victim-${tag}`
  try {
    const victim = await prisma.user.findFirstOrThrow({ where: { email: SEED.client.email } })
    await prisma.deviceToken.create({ data: { token, platform: 'IOS', userId: victim.id } })

    // A completely unrelated business signs in and posts the victim's token.
    await asRival(page)
    await page.request.delete('/api/devices/register', { data: { token } })

    expect(
      await prisma.deviceToken.count({ where: { token, userId: victim.id } }),
      'a device token belongs to the account that registered it',
    ).toBe(1)
  } finally {
    await prisma.deviceToken.deleteMany({ where: { token } }).catch(() => {})
    await prisma.$disconnect()
  }
})

// ─── /dogs/[dogId]/media/[mediaId] and /dogs/[dogId]/photo ────────────────────

test('removing one gallery item or the profile photo leaves the dog and the rest of the gallery', async ({ page }) => {
  const prisma = await makePrisma()
  const tag = tagFor('dog')
  let dogId = ''
  try {
    const owner = await ownerProfile(prisma)
    const dog = await prisma.dog.create({
      data: { name: `Undo Dog ${tag}`, clientProfileId: SEED.assignedClientId, photoUrl: 'https://blob.test/face.jpg' },
    })
    dogId = dog.id
    const keep = await prisma.dogMedia.create({
      data: { dogId, trainerId: owner.id, kind: 'IMAGE', url: 'https://blob.test/keep.jpg', caption: `keep ${tag}` },
    })
    const drop = await prisma.dogMedia.create({
      data: { dogId, trainerId: owner.id, kind: 'IMAGE', url: 'https://blob.test/drop.jpg', caption: `drop ${tag}` },
    })

    // Another business cannot reach into this dog's record at all.
    await asRival(page)
    expect([403, 404]).toContain((await page.request.delete(`/api/dogs/${dogId}/media/${drop.id}`)).status())
    expect([403, 404]).toContain((await page.request.delete(`/api/dogs/${dogId}/photo`)).status())
    expect(await prisma.dogMedia.count({ where: { id: drop.id } })).toBe(1)
    expect((await prisma.dog.findUniqueOrThrow({ where: { id: dogId } })).photoUrl).not.toBeNull()

    await asOwner(page)
    const goneMedia = await page.request.delete(`/api/dogs/${dogId}/media/${drop.id}`)
    expect(goneMedia.status(), await goneMedia.text()).toBe(200)
    expect(await prisma.dogMedia.count({ where: { id: drop.id } })).toBe(0)
    expect(await prisma.dogMedia.count({ where: { id: keep.id } }), 'only the one asked for').toBe(1)
    expect(await prisma.dog.count({ where: { id: dogId } }), 'the dog is not its photos').toBe(1)

    const gonePhoto = await page.request.delete(`/api/dogs/${dogId}/photo`)
    expect(gonePhoto.status(), await gonePhoto.text()).toBe(200)
    const after = await prisma.dog.findUniqueOrThrow({ where: { id: dogId } })
    expect(after.photoUrl, 'the profile photo clears').toBeNull()
    expect(after.name, 'and nothing else about the dog moves').toBe(`Undo Dog ${tag}`)
    expect(
      await prisma.dogMedia.count({ where: { dogId } }),
      'clearing the profile photo must not empty the gallery',
    ).toBe(1)
  } finally {
    if (dogId) {
      await prisma.dogMedia.deleteMany({ where: { dogId } }).catch(() => {})
      await prisma.dog.deleteMany({ where: { id: dogId } }).catch(() => {})
    }
    await prisma.$disconnect()
  }
})

// ─── /message-groups/[groupId]/messages/[messageId] + /participants/[participantId] ──

test('moderating a group tombstones the post and the member, and never rewrites the thread', async ({ page }) => {
  const prisma = await makePrisma()
  const tag = tagFor('grp')
  let groupId = ''
  try {
    const owner = await ownerProfile(prisma)
    const ownerUser = await prisma.user.findFirstOrThrow({ where: { email: SEED.owner.email } })
    const client = await prisma.clientProfile.findUniqueOrThrow({
      where: { id: SEED.assignedClientId }, select: { id: true, userId: true },
    })

    const group = await prisma.messageGroup.create({
      data: { trainerId: owner.id, name: `Undo group ${tag}`, mode: 'COMMUNITY', scope: 'MANUAL' },
    })
    groupId = group.id
    await prisma.messageGroupParticipant.create({
      data: { groupId, userId: ownerUser.id, role: 'OWNER', displayName: 'Olivia', joinedAt: new Date() },
    })
    const participant = await prisma.messageGroupParticipant.create({
      data: {
        groupId, userId: client.userId, clientProfileId: client.id, role: 'CLIENT',
        displayName: 'Sarah', joinedAt: new Date(),
      },
    })
    const post = await prisma.groupMessage.create({
      data: { groupId, senderId: client.userId, body: `undo post ${tag}`, visibility: 'EVERYONE' },
    })
    const otherPost = await prisma.groupMessage.create({
      data: { groupId, senderId: client.userId, body: `undo kept post ${tag}`, visibility: 'EVERYONE' },
    })

    // Business B cannot moderate business A's group.
    await asRival(page)
    expect((await page.request.delete(`/api/message-groups/${groupId}/messages/${post.id}`)).status()).toBe(404)
    expect((await page.request.delete(`/api/message-groups/${groupId}/participants/${participant.id}`)).status()).toBe(404)
    expect((await prisma.groupMessage.findUniqueOrThrow({ where: { id: post.id } })).deletedAt).toBeNull()
    expect((await prisma.messageGroupParticipant.findUniqueOrThrow({ where: { id: participant.id } })).leftAt).toBeNull()

    await asOwner(page)
    expect((await page.request.delete(`/api/message-groups/${groupId}/messages/${post.id}`)).status()).toBe(200)
    expect((await page.request.delete(`/api/message-groups/${groupId}/participants/${participant.id}`)).status()).toBe(200)

    // The removed post is a tombstone, not a hole: the row and its words stay,
    // so a moderation decision is auditable and the thread still reads.
    const moderated = await prisma.groupMessage.findUniqueOrThrow({ where: { id: post.id } })
    expect(moderated.deletedAt, 'tombstoned').not.toBeNull()
    expect(moderated.body, 'and the row survives it').toContain('undo post')

    // Removing the member does NOT delete what they said.
    expect(
      await prisma.groupMessage.count({ where: { id: otherPost.id, deletedAt: null } }),
      'a removed member s other posts stay in the thread',
    ).toBe(1)
    const left = await prisma.messageGroupParticipant.findUniqueOrThrow({ where: { id: participant.id } })
    expect(left.leftAt).not.toBeNull()
    expect(left.optedOutAt, 'so a roster refresh cannot quietly re-add them').not.toBeNull()

    // And the reader never sees the removed post.
    const view = await (await page.request.get(`/api/message-groups/${groupId}/messages`)).json()
    expect(JSON.stringify(view.messages ?? [])).not.toContain(`undo post ${tag}`)
  } finally {
    if (groupId) await prisma.messageGroup.deleteMany({ where: { id: groupId } }).catch(() => {})
    await prisma.$disconnect()
  }
})

// ─── /review/comments/[id] ────────────────────────────────────────────────────

test('deleting a review note takes its replies and nothing else — and 404s when the widget is off', async ({ page }) => {
  // The review endpoints take UNAUTHENTICATED writes so an agent can mark items
  // off with curl. That is only safe because the whole surface 404s unless
  // review tools are on, so BOTH contracts get asserted here — which one applies
  // depends on the environment the suite was built in (REVIEW_TOOLS / NODE_ENV).
  const prisma = await makePrisma()
  const tag = tagFor('rev')
  const made: string[] = []
  try {
    const parent = await prisma.reviewComment.create({
      data: { pageKey: `undo/${tag}`, body: `undo review note ${tag}` },
    })
    made.push(parent.id)
    const reply = await prisma.reviewComment.create({
      data: { pageKey: `undo/${tag}`, body: `undo reply ${tag}`, parentId: parent.id },
    })
    made.push(reply.id)
    // A second, unrelated pin on the same screen — the blast radius check.
    const bystander = await prisma.reviewComment.create({
      data: { pageKey: `undo/${tag}`, body: `undo bystander ${tag}` },
    })
    made.push(bystander.id)

    const res = await page.request.delete(`/api/review/comments/${parent.id}`)

    if (res.status() === 404) {
      // Review tools off — a build tool has no business on a deployed instance,
      // and an unauthenticated DELETE must change nothing at all.
      expect(await prisma.reviewComment.count({ where: { id: { in: made } } })).toBe(3)
    } else {
      expect(res.status(), await res.text()).toBe(200)
      expect(await prisma.reviewComment.count({ where: { id: parent.id } })).toBe(0)
      expect(
        await prisma.reviewComment.count({ where: { id: reply.id } }),
        'a clarification on a deleted note says nothing on its own',
      ).toBe(0)
      expect(
        await prisma.reviewComment.count({ where: { id: bystander.id } }),
        'the other pins on that screen are not yours to take',
      ).toBe(1)
    }
  } finally {
    await prisma.reviewComment.deleteMany({ where: { id: { in: made } } }).catch(() => {})
    await prisma.$disconnect()
  }
})

// ─── /schedule/[sessionId]/buddies/[buddyId] ──────────────────────────────────

async function makeWalkSeries(prisma: any, trainerId: string, tag: string, count: number) {
  const walkSeriesId = `undo-series-${tag}`
  const ids: string[] = []
  for (let i = 0; i < count; i++) {
    const s = await prisma.trainingSession.create({
      data: {
        trainerId, title: `Undo walk ${i + 1} ${tag}`,
        scheduledAt: new Date(Date.now() + (7 + i * 7) * 864e5),
        durationMins: 60, status: 'UPCOMING', walkSeriesId,
      },
    })
    ids.push(s.id)
  }
  return ids
}

test('taking a dog off a walk removes that buddy row and nothing else', async ({ page }) => {
  const prisma = await makePrisma()
  const tag = tagFor('buddy')
  let sessionIds: string[] = []
  try {
    const owner = await ownerProfile(prisma)
    sessionIds = await makeWalkSeries(prisma, owner.id, tag, 1)
    const dog = await prisma.dog.findFirstOrThrow({
      where: { primaryFor: { some: { id: SEED.assignedClientId } } }, select: { id: true },
    })

    await asOwner(page)
    const added = await page.request.post(`/api/schedule/${sessionIds[0]}/buddies`, {
      data: { clientId: SEED.assignedClientId, dogId: dog.id, scope: 'this' },
    })
    expect(added.status(), await added.text()).toBe(201)
    const buddyId = (await added.json()).id

    // Business B cannot pull a dog off business A's walk.
    await asRival(page)
    expect((await page.request.delete(`/api/schedule/${sessionIds[0]}/buddies/${buddyId}`)).status()).toBe(404)
    expect(await prisma.sessionBuddy.count({ where: { id: buddyId } })).toBe(1)

    await asOwner(page)
    const gone = await page.request.delete(`/api/schedule/${sessionIds[0]}/buddies/${buddyId}`)
    expect(gone.status(), await gone.text()).toBe(200)
    expect(await prisma.sessionBuddy.count({ where: { id: buddyId } })).toBe(0)
    // Coming off a walk is not leaving the business.
    expect(await prisma.trainingSession.count({ where: { id: sessionIds[0] } })).toBe(1)
    expect(await prisma.dog.count({ where: { id: dog.id } })).toBe(1)
    expect(await prisma.clientProfile.count({ where: { id: SEED.assignedClientId } })).toBe(1)
  } finally {
    if (sessionIds.length) {
      await prisma.sessionBuddy.deleteMany({ where: { sessionId: { in: sessionIds } } }).catch(() => {})
      await prisma.trainingSession.deleteMany({ where: { id: { in: sessionIds } } }).catch(() => {})
    }
    await prisma.$disconnect()
  }
})

test('a dog added to a whole walk series can be taken off the whole series', async ({ page }) => {
  // T-14, fixed 2026-08-05. Adding reaches the whole run (the picker defaults to
  // "series"); removing reached one walk, so a dog taken off stayed booked onto
  // every later one. DELETE reads ?scope the way its sibling route already did,
  // and the screen sends the same scope it added with.
  const prisma = await makePrisma()
  const tag = tagFor('bseries')
  let sessionIds: string[] = []
  try {
    const owner = await ownerProfile(prisma)
    sessionIds = await makeWalkSeries(prisma, owner.id, tag, 3)
    const dog = await prisma.dog.findFirstOrThrow({
      where: { primaryFor: { some: { id: SEED.assignedClientId } } }, select: { id: true },
    })

    await asOwner(page)
    const added = await page.request.post(`/api/schedule/${sessionIds[0]}/buddies`, {
      data: { clientId: SEED.assignedClientId, dogId: dog.id, scope: 'series' },
    })
    expect(added.status(), await added.text()).toBe(201)
    const buddyId = (await added.json()).id
    expect(
      await prisma.sessionBuddy.count({ where: { sessionId: { in: sessionIds } } }),
      'the add reached every walk in the series',
    ).toBe(3)

    await page.request.delete(`/api/schedule/${sessionIds[0]}/buddies/${buddyId}?scope=series`)

    expect(
      await prisma.sessionBuddy.count({ where: { sessionId: { in: sessionIds } } }),
      'so the undo has to be able to reach every walk too',
    ).toBe(0)
  } finally {
    if (sessionIds.length) {
      await prisma.sessionBuddy.deleteMany({ where: { sessionId: { in: sessionIds } } }).catch(() => {})
      await prisma.trainingSession.deleteMany({ where: { id: { in: sessionIds } } }).catch(() => {})
    }
    await prisma.$disconnect()
  }
})

// ─── /schedule/notify-reschedules ─────────────────────────────────────────────

test('dismissing the reschedule banner tells nobody, and reaches only your own business', async ({ page }) => {
  const prisma = await makePrisma()
  const tag = tagFor('resched')
  let sessionId = ''
  try {
    const owner = await ownerProfile(prisma)
    const client = await prisma.clientProfile.findUniqueOrThrow({
      where: { id: SEED.assignedClientId }, select: { id: true, userId: true, dogId: true },
    })
    const session = await prisma.trainingSession.create({
      data: {
        trainerId: owner.id, clientId: client.id, dogId: client.dogId,
        title: `Undo reschedule ${tag}`,
        scheduledAt: new Date(Date.now() + 10 * 864e5),
        durationMins: 60, status: 'UPCOMING',
        rescheduleNotifyPendingAt: new Date(),
      },
    })
    sessionId = session.id
    const notifiedBefore = await prisma.notification.count({ where: { userId: client.userId } })

    // Another business's dismiss must not clear this trainer's pending flags.
    await asRival(page)
    const rivalCleared = await page.request.delete('/api/schedule/notify-reschedules')
    expect(rivalCleared.status()).toBe(200)
    expect(
      (await prisma.trainingSession.findUniqueOrThrow({ where: { id: sessionId } })).rescheduleNotifyPendingAt,
      'business B cannot dismiss business A s banner',
    ).not.toBeNull()

    await asOwner(page)
    const listed = await page.request.get('/api/schedule/notify-reschedules')
    expect(listed.status()).toBe(200)
    expect((await listed.json()).sessions, 'the banner sees it').toBeGreaterThanOrEqual(1)

    const dismissed = await page.request.delete('/api/schedule/notify-reschedules')
    expect(dismissed.status(), await dismissed.text()).toBe(200)

    const after = await prisma.trainingSession.findUniqueOrThrow({ where: { id: sessionId } })
    expect(after.rescheduleNotifyPendingAt, 'the flag clears').toBeNull()
    expect(after.scheduledAt.getTime(), 'dismissing the NOTICE never moves the session back').toBe(session.scheduledAt.getTime())
    expect(
      await prisma.notification.count({ where: { userId: client.userId } }),
      'dismiss is the silent option — nobody is told',
    ).toBe(notifiedBefore)
    expect((await (await page.request.get('/api/schedule/notify-reschedules')).json()).sessions).toBe(0)
  } finally {
    if (sessionId) await prisma.trainingSession.deleteMany({ where: { id: sessionId } }).catch(() => {})
    await prisma.$disconnect()
  }
})

// ─── /sessions/[sessionId]/attachments/[attachmentId] ─────────────────────────

test('deleting one session attachment leaves the session and its other files', async ({ page }) => {
  const prisma = await makePrisma()
  const tag = tagFor('att')
  let sessionId = ''
  try {
    const owner = await ownerProfile(prisma)
    const session = await prisma.trainingSession.create({
      data: {
        trainerId: owner.id, clientId: SEED.assignedClientId, title: `Undo attach ${tag}`,
        scheduledAt: new Date(Date.now() - 864e5), durationMins: 60, status: 'COMPLETED',
      },
    })
    sessionId = session.id
    const keep = await prisma.sessionAttachment.create({
      data: { sessionId, trainerId: owner.id, kind: 'IMAGE', url: `https://blob.test/keep-${tag}.jpg`, sizeBytes: 100 },
    })
    const drop = await prisma.sessionAttachment.create({
      data: { sessionId, trainerId: owner.id, kind: 'IMAGE', url: `https://blob.test/drop-${tag}.jpg`, sizeBytes: 100 },
    })

    await asRival(page)
    expect((await page.request.delete(`/api/sessions/${sessionId}/attachments/${drop.id}`)).status()).toBe(404)
    expect(await prisma.sessionAttachment.count({ where: { id: drop.id } })).toBe(1)

    await asOwner(page)
    const gone = await page.request.delete(`/api/sessions/${sessionId}/attachments/${drop.id}`)
    expect(gone.status(), await gone.text()).toBe(200)
    expect(await prisma.sessionAttachment.count({ where: { id: drop.id } })).toBe(0)
    expect(await prisma.sessionAttachment.count({ where: { id: keep.id } })).toBe(1)
    expect(await prisma.trainingSession.count({ where: { id: sessionId } }), 'the visit still happened').toBe(1)
  } finally {
    if (sessionId) {
      await prisma.sessionAttachment.deleteMany({ where: { sessionId } }).catch(() => {})
      await prisma.trainingSession.deleteMany({ where: { id: sessionId } }).catch(() => {})
    }
    await prisma.$disconnect()
  }
})

// ─── /system-emails ───────────────────────────────────────────────────────────

test('resetting a system email restores the default wording and touches nobody else', async ({ page }) => {
  const prisma = await makePrisma()
  const tag = tagFor('sysmail')
  const KEY = 'invoice_new'
  let ownerId = ''
  let rivalId = ''
  let keptTemplateId = ''
  try {
    const owner = await ownerProfile(prisma)
    ownerId = owner.id
    const rival = await prisma.trainerProfile.findFirstOrThrow({
      where: { user: { email: SEED.businessB.ownerEmail } },
    })
    rivalId = rival.id

    // Business B has customised the SAME email — resetting A's must not reset B's.
    await prisma.emailTemplate.create({
      data: { trainerId: rival.id, systemKey: KEY, name: 'Rival invoice', category: 'system', subject: `rival ${tag}`, body: `rival body ${tag}` },
    })
    // And A has an ordinary (non-system) template that has nothing to do with this.
    const kept = await prisma.emailTemplate.create({
      data: { trainerId: owner.id, name: `Undo keeper ${tag}`, category: 'custom', subject: 'Keep me', body: 'Keep me' },
    })
    keptTemplateId = kept.id

    await asOwner(page)
    const saved = await page.request.put('/api/system-emails', {
      data: { key: KEY, subject: `Undo subject ${tag}`, body: `<p>Undo body ${tag}</p>` },
    })
    expect(saved.status(), await saved.text()).toBe(200)

    let listed = await (await page.request.get('/api/system-emails')).json()
    let entry = listed.emails.find((e: any) => e.key === KEY)
    expect(entry.customised).toBe(true)
    expect(entry.subject).toBe(`Undo subject ${tag}`)
    const theDefault = entry.defaultSubject

    // A key that isn't ours is not a licence to delete anything.
    expect((await page.request.delete('/api/system-emails?key=not_a_real_email')).status()).toBe(404)

    const reset = await page.request.delete(`/api/system-emails?key=${KEY}`)
    expect(reset.status(), await reset.text()).toBe(200)

    listed = await (await page.request.get('/api/system-emails')).json()
    entry = listed.emails.find((e: any) => e.key === KEY)
    expect(entry.customised, 'deleting the override IS the reset').toBe(false)
    expect(entry.subject, 'and the wording falls back to ours').toBe(theDefault)
    expect(
      await prisma.emailTemplate.count({ where: { trainerId: owner.id, systemKey: KEY } }),
      'nothing left behind',
    ).toBe(0)

    // Blast radius: exactly one row.
    expect(
      await prisma.emailTemplate.count({ where: { trainerId: rival.id, systemKey: KEY } }),
      'another business s wording is not yours to reset',
    ).toBe(1)
    expect(
      await prisma.emailTemplate.count({ where: { id: keptTemplateId } }),
      'and your own unrelated templates stay',
    ).toBe(1)

    // The invite wording lives on the profile, not the table — same reset.
    const invite = await page.request.put('/api/system-emails', {
      data: { key: 'client_invite', subject: '', body: `Come and join us ${tag}` },
    })
    expect(invite.status(), await invite.text()).toBe(200)
    expect((await prisma.trainerProfile.findUniqueOrThrow({ where: { id: owner.id } })).inviteTemplate).toContain(tag)
    expect((await page.request.delete('/api/system-emails?key=client_invite')).status()).toBe(200)
    expect((await prisma.trainerProfile.findUniqueOrThrow({ where: { id: owner.id } })).inviteTemplate).toBeNull()
  } finally {
    if (ownerId) await prisma.emailTemplate.deleteMany({ where: { trainerId: ownerId, systemKey: KEY } }).catch(() => {})
    if (rivalId) await prisma.emailTemplate.deleteMany({ where: { trainerId: rivalId, systemKey: KEY } }).catch(() => {})
    if (keptTemplateId) await prisma.emailTemplate.deleteMany({ where: { id: keptTemplateId } }).catch(() => {})
    if (ownerId) await prisma.trainerProfile.updateMany({ where: { id: ownerId }, data: { inviteTemplate: null } }).catch(() => {})
    await prisma.$disconnect()
  }
})

// ─── /tags/[tagId] ────────────────────────────────────────────────────────────

test('deleting a tag deletes the label, never the things it labelled', async ({ page }) => {
  const prisma = await makePrisma()
  const tag = tagFor('tag')
  let tagId = ''
  try {
    const owner = await ownerProfile(prisma)
    const row = await prisma.tag.create({
      data: { trainerId: owner.id, name: `Undo ${tag}`, nameKey: `undo ${tag}`.toLowerCase() },
    })
    tagId = row.id
    await prisma.tagAssignment.create({ data: { tagId, packageId: SEED.selfBookPackageId } })

    await asRival(page)
    expect((await page.request.delete(`/api/tags/${tagId}`)).status()).toBe(404)
    expect(await prisma.tag.count({ where: { id: tagId } })).toBe(1)

    await asOwner(page)
    const gone = await page.request.delete(`/api/tags/${tagId}`)
    expect(gone.status(), await gone.text()).toBe(200)
    expect((await gone.json()).untagged, 'and it says how much it unlabelled').toBe(1)

    expect(await prisma.tag.count({ where: { id: tagId } })).toBe(0)
    tagId = ''
    expect(await prisma.tagAssignment.count({ where: { tagId: row.id } })).toBe(0)
    // The offering it was on is still on sale.
    const pkg = await prisma.package.findUniqueOrThrow({ where: { id: SEED.selfBookPackageId } })
    expect(pkg.name, 'tidying labels must never cost a trainer their catalogue').toBe('Self-Book Session')
  } finally {
    if (tagId) {
      await prisma.tagAssignment.deleteMany({ where: { tagId } }).catch(() => {})
      await prisma.tag.deleteMany({ where: { id: tagId } }).catch(() => {})
    }
    await prisma.$disconnect()
  }
})

// ─── /todos/[todoId] ──────────────────────────────────────────────────────────

test('a to-do deletes for its own business only', async ({ page }) => {
  const prisma = await makePrisma()
  const tag = tagFor('todo')
  let todoId = ''
  try {
    await asOwner(page)
    const created = await page.request.post('/api/todos', { data: { title: `Undo todo ${tag}` } })
    expect(created.status(), await created.text()).toBe(201)
    todoId = (await created.json()).todo.id

    await asRival(page)
    expect((await page.request.delete(`/api/todos/${todoId}`)).status()).toBe(404)
    expect(await prisma.trainerTodo.count({ where: { id: todoId } })).toBe(1)

    await asOwner(page)
    expect((await page.request.delete(`/api/todos/${todoId}`)).status()).toBe(200)
    expect(await prisma.trainerTodo.count({ where: { id: todoId } })).toBe(0)
    // A second delete is a 404, not a silent ok — the row is genuinely gone.
    expect((await page.request.delete(`/api/todos/${todoId}`)).status()).toBe(404)
    todoId = ''
  } finally {
    if (todoId) await prisma.trainerTodo.deleteMany({ where: { id: todoId } }).catch(() => {})
    await prisma.$disconnect()
  }
})

// ─── comms flow: steps on a class run and on a membership, and the template ───

test('deleting a comms-flow step removes that message only, not the flow or what was already sent', async ({ page }) => {
  const prisma = await makePrisma()
  const tag = tagFor('flow')
  let packageId = ''
  let membershipId = ''
  try {
    const owner = await ownerProfile(prisma)
    await asOwner(page)

    const madePkg = await page.request.post('/api/packages', {
      data: {
        name: `Undo flow class ${tag}`, sessionCount: 2, weeksBetween: 1, durationMins: 60,
        isGroup: true, capacity: 6, startAt: new Date(Date.now() + 30 * 864e5).toISOString(),
      },
    })
    expect(madePkg.status(), await madePkg.text()).toBeLessThan(300)
    packageId = (await madePkg.json()).id
    const run = await prisma.classRun.findFirstOrThrow({ where: { packageId } })

    // Two steps on the run, so "delete one" has something to leave behind.
    const stepA = await (await page.request.post(`/api/trainer/class-runs/${run.id}/comms-flow`, {
      data: { direction: 'BEFORE_SESSION', offsetMinutes: 1440, title: `Undo step A ${tag}`, body: 'See you tomorrow' },
    })).json()
    const stepB = await (await page.request.post(`/api/trainer/class-runs/${run.id}/comms-flow`, {
      data: { direction: 'BEFORE_SESSION', offsetMinutes: 15, title: `Undo step B ${tag}`, body: 'Starting soon' },
    })).json()
    expect(stepA.id && stepB.id, JSON.stringify({ stepA, stepB })).toBeTruthy()

    // A membership with its own step, on the sibling route.
    const membership = await prisma.membership.create({
      data: { trainerId: owner.id, name: `Undo flow package ${tag}`, priceCents: 5000, published: false },
    })
    membershipId = membership.id
    const mStep = await (await page.request.post(`/api/trainer/memberships/${membershipId}/comms-flow`, {
      data: { direction: 'AFTER_PURCHASE', offsetMinutes: 0, title: `Undo mstep ${tag}`, body: 'Welcome aboard' },
    })).json()
    expect(mStep.id, JSON.stringify(mStep)).toBeTruthy()

    // Save the run's flow as a reusable template — the template is a COPY.
    const template = await page.request.post('/api/trainer/comms-flow-templates', {
      data: { name: `Undo template ${tag}`, runId: run.id },
    })
    expect(template.status(), await template.text()).toBe(201)
    const templateId = (await template.json()).id

    // Business B owns none of it.
    await asRival(page)
    expect((await page.request.delete(`/api/trainer/class-runs/${run.id}/comms-flow/${stepA.id}`)).status()).toBe(404)
    expect((await page.request.delete(`/api/trainer/memberships/${membershipId}/comms-flow/${mStep.id}`)).status()).toBe(404)
    expect((await page.request.delete(`/api/trainer/comms-flow-templates/${templateId}`)).status()).toBe(404)
    expect(await prisma.commsFlowStep.count({ where: { id: stepA.id } })).toBe(1)
    expect(await prisma.commsFlowTemplate.count({ where: { id: templateId } })).toBe(1)

    await asOwner(page)
    expect((await page.request.delete(`/api/trainer/class-runs/${run.id}/comms-flow/${stepA.id}`)).status()).toBe(200)
    expect(await prisma.commsFlowStep.count({ where: { id: stepA.id } })).toBe(0)
    expect(await prisma.commsFlowStep.count({ where: { id: stepB.id } }), 'the rest of the flow stands').toBe(1)
    expect(await prisma.classRun.count({ where: { id: run.id } }), 'and so does the class').toBe(1)

    expect((await page.request.delete(`/api/trainer/memberships/${membershipId}/comms-flow/${mStep.id}`)).status()).toBe(200)
    expect(await prisma.commsFlowStep.count({ where: { id: mStep.id } })).toBe(0)
    expect(await prisma.membership.count({ where: { id: membershipId } }), 'the package is not its messages').toBe(1)

    // A template is a saved copy. Deleting it must not un-build the flow that
    // was made from it.
    expect((await page.request.delete(`/api/trainer/comms-flow-templates/${templateId}`)).status()).toBe(200)
    expect(await prisma.commsFlowTemplate.count({ where: { id: templateId } })).toBe(0)
    expect(
      await prisma.commsFlowStep.count({ where: { classRunId: run.id } }),
      'deleting the recipe does not delete the meal',
    ).toBe(1)
  } finally {
    if (membershipId) {
      await prisma.commsFlowStep.deleteMany({ where: { membershipId } }).catch(() => {})
      await prisma.membership.deleteMany({ where: { id: membershipId } }).catch(() => {})
    }
    await prisma.commsFlowTemplate.deleteMany({ where: { name: { contains: tag } } }).catch(() => {})
    if (packageId) {
      const runs = await prisma.classRun.findMany({ where: { packageId }, select: { id: true } })
      await prisma.commsFlowStep.deleteMany({ where: { classRunId: { in: runs.map((r: any) => r.id) } } }).catch(() => {})
      await prisma.trainingSession.deleteMany({ where: { classRunId: { in: runs.map((r: any) => r.id) } } }).catch(() => {})
      await prisma.classRun.deleteMany({ where: { packageId } }).catch(() => {})
      await prisma.package.deleteMany({ where: { id: packageId } }).catch(() => {})
    }
    await prisma.$disconnect()
  }
})

// ─── /trainer/lead-magnets/[id] ───────────────────────────────────────────────

test('deleting a lead magnet keeps the leads it captured', async ({ page }) => {
  // The magnet is the offer; the subscribers are people who typed their email
  // in and ticked a consent box. Exactly the shape of T-5 and T-7 — and here
  // the FK is SetNull on purpose, so this is the version that behaves.
  const prisma = await makePrisma()
  const tag = tagFor('magnet')
  let magnetId = ''
  let subscriberId = ''
  let addonCreated = false
  let ownerId = ''
  try {
    const owner = await ownerProfile(prisma)
    ownerId = owner.id
    // The route is behind a PAID add-on the seed doesn't enable.
    const existing = await prisma.trainerAddon.findFirst({ where: { trainerId: owner.id, itemId: 'leadmagnets' } })
    if (!existing) {
      await prisma.trainerAddon.create({ data: { trainerId: owner.id, itemId: 'leadmagnets', active: true, grantedByAdmin: true } })
      addonCreated = true
    }

    const magnet = await prisma.leadMagnet.create({
      data: {
        trainerId: owner.id, slug: `undo-${tag}`, title: `Undo magnet ${tag}`,
        fileUrl: 'https://blob.test/guide.pdf', fileName: 'guide.pdf',
      },
    })
    magnetId = magnet.id
    const sub = await prisma.subscriber.create({
      data: {
        trainerId: owner.id, email: `undo-lead-${tag}@e2e.test`, name: 'Lead Person',
        sourceLeadMagnetId: magnet.id, consentText: 'I agree', consentAt: new Date(),
      },
    })
    subscriberId = sub.id

    await asRival(page)
    expect([403, 404]).toContain((await page.request.delete(`/api/trainer/lead-magnets/${magnetId}`)).status())
    expect(await prisma.leadMagnet.count({ where: { id: magnetId } })).toBe(1)

    await asOwner(page)
    const gone = await page.request.delete(`/api/trainer/lead-magnets/${magnetId}`)
    expect(gone.status(), await gone.text()).toBe(200)
    expect(await prisma.leadMagnet.count({ where: { id: magnetId } })).toBe(0)
    magnetId = ''

    const after = await prisma.subscriber.findUniqueOrThrow({ where: { id: subscriberId } })
    expect(after.email, 'the lead survives the offer being withdrawn').toBe(`undo-lead-${tag}@e2e.test`)
    expect(after.sourceLeadMagnetId, 'only the attribution detaches').toBeNull()
    expect(after.consentAt, 'and the consent trail stays intact').not.toBeNull()
  } finally {
    if (subscriberId) await prisma.subscriber.deleteMany({ where: { id: subscriberId } }).catch(() => {})
    if (magnetId) await prisma.leadMagnet.deleteMany({ where: { id: magnetId } }).catch(() => {})
    if (addonCreated && ownerId) {
      await prisma.trainerAddon.deleteMany({ where: { trainerId: ownerId, itemId: 'leadmagnets' } }).catch(() => {})
    }
    await prisma.$disconnect()
  }
})

// ─── /trainer/memberships/[id]/invites ────────────────────────────────────────

test('withdrawing an invitation declines it, and never touches someone who already joined', async ({ page }) => {
  const prisma = await makePrisma()
  const tag = tagFor('invite')
  let membershipId = ''
  try {
    const owner = await ownerProfile(prisma)
    const membership = await prisma.membership.create({
      data: { trainerId: owner.id, name: `Undo invites ${tag}`, priceCents: 4500, published: false },
    })
    membershipId = membership.id

    const invited = await prisma.membershipRequest.create({
      data: { membershipId, clientId: SEED.assignedClientId, reason: 'INVITE', status: 'PENDING' },
    })
    const joined = await prisma.membershipRequest.create({
      data: {
        membershipId, clientId: SEED.unassignedClientId, reason: 'INVITE',
        status: 'FULFILLED', fulfilledAt: new Date(),
      },
    })

    await asRival(page)
    expect((await page.request.delete(`/api/trainer/memberships/${membershipId}/invites`, {
      data: { clientIds: [SEED.assignedClientId] },
    })).status()).toBe(404)
    expect((await prisma.membershipRequest.findUniqueOrThrow({ where: { id: invited.id } })).status).toBe('PENDING')

    await asOwner(page)
    const withdrawn = await page.request.delete(`/api/trainer/memberships/${membershipId}/invites`, {
      data: { clientIds: [SEED.assignedClientId, SEED.unassignedClientId] },
    })
    expect(withdrawn.status(), await withdrawn.text()).toBe(200)
    expect((await withdrawn.json()).withdrawn, 'only the outstanding one').toBe(1)

    const a = await prisma.membershipRequest.findUniqueOrThrow({ where: { id: invited.id } })
    expect(a.status, 'declined, not deleted — "we invited them and then didn t" stays visible').toBe('DECLINED')

    const b = await prisma.membershipRequest.findUniqueOrThrow({ where: { id: joined.id } })
    expect(b.status, 'taking a package off someone who has it is a cancellation, not a withdrawal').toBe('FULFILLED')
    expect(b.fulfilledAt).not.toBeNull()

    // Another business's client id is not a target either.
    const rivalTry = await page.request.delete(`/api/trainer/memberships/${membershipId}/invites`, {
      data: { clientIds: [SEED.businessB.clientId] },
    })
    expect(rivalTry.status()).toBe(200)
    expect((await rivalTry.json()).withdrawn).toBe(0)
  } finally {
    if (membershipId) {
      await prisma.membershipRequest.deleteMany({ where: { membershipId } }).catch(() => {})
      await prisma.membership.deleteMany({ where: { id: membershipId } }).catch(() => {})
    }
    await prisma.$disconnect()
  }
})
