import { test, expect, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'
import { SEED, TEST_DATABASE_URL } from './test-db'

// Group messaging, end to end.
//
// A group is its own thread that sits beside the 1:1 client threads. Two
// modes, and what this spec mostly checks is the promise each one makes:
//
//   BROADCAST  members never see each other. A client's reply reaches the
//              trainer's team and nobody else.
//   COMMUNITY  everyone sees everyone — which is why nobody is in it until
//              they have actually said yes.

const PHONE = { width: 390, height: 844 }

async function makePrisma() {
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

/** Remove every group this spec made, so the shared seeded DB is unchanged. */
async function cleanup(tag: string) {
  const prisma = await makePrisma()
  try {
    await prisma.messageGroup.deleteMany({ where: { name: { contains: tag } } })
  } finally {
    await prisma.$disconnect()
  }
}

/** Build a group straight in the DB when the test is about something else. */
async function seedGroup(opts: {
  tag: string
  mode: 'BROADCAST' | 'COMMUNITY'
  /** ClientProfile ids to put in it. */
  clientIds: string[]
  joined?: boolean
}) {
  const prisma = await makePrisma()
  try {
    const clients = await prisma.clientProfile.findMany({
      where: { id: { in: opts.clientIds } },
      select: { id: true, userId: true, trainerId: true, trainer: { select: { userId: true } } },
    })
    const trainerId = clients[0].trainerId
    const trainerUserId = clients[0].trainer.userId
    const group = await prisma.messageGroup.create({
      data: { trainerId, name: `${opts.tag} group`, mode: opts.mode, scope: 'MANUAL' },
    })
    await prisma.messageGroupParticipant.create({
      data: { groupId: group.id, userId: trainerUserId, role: 'OWNER', displayName: 'Olivia', joinedAt: new Date() },
    })
    for (const c of clients) {
      await prisma.messageGroupParticipant.create({
        data: {
          groupId: group.id,
          userId: c.userId,
          clientProfileId: c.id,
          role: 'CLIENT',
          displayName: `C${c.id.slice(-4)}`,
          joinedAt: (opts.joined ?? opts.mode === 'BROADCAST') ? new Date() : null,
        },
      })
    }
    return { groupId: group.id, trainerUserId, clients }
  } finally {
    await prisma.$disconnect()
  }
}

test.describe('group messaging', () => {
  test('trainer creates a broadcast group, posts, and the client sees it', async ({ page }) => {
    const tag = `E2E-GRP-${Date.now()}`
    await login(page, SEED.owner.email, SEED.owner.password)
    await page.setViewportSize(PHONE)
    await page.goto('/messages')

    await page.getByTestId('open-group-composer').click()
    const composer = page.getByTestId('group-composer')
    await expect(composer).toBeVisible()

    // Hand-pick everyone, then the mode question.
    await composer.getByRole('button', { name: /Choose people/ }).click()
    await composer.getByRole('button', { name: /^Select all/ }).click()
    await composer.getByRole('button', { name: /^Next \(/ }).click()

    // The mode screen must spell out the consequence, not just name the modes.
    await expect(composer.getByTestId('mode-broadcast')).toContainText(/Nobody sees anyone else/i)
    await expect(composer.getByTestId('mode-community')).toContainText(/see each other/i)
    await composer.getByTestId('mode-broadcast').click()

    await composer.getByTestId('group-name').fill(`${tag} Spring Puppy Class`)
    await composer.getByTestId('group-create').click()

    // Lands in the new group's thread.
    await page.waitForURL(/\/messages\?group=/, { timeout: 20_000 })
    await page.getByTestId('group-composer-input').fill(`${tag} tonight is cancelled, the field is flooded`)
    await page.getByTestId('group-post').click()
    await expect(page.getByText(`${tag} tonight is cancelled, the field is flooded`)).toBeVisible({ timeout: 15_000 })

    // It is a thread in the messages list, not a one-off send.
    await page.goto('/messages')
    await expect(page.getByTestId('group-row').filter({ hasText: `${tag} Spring Puppy Class` })).toBeVisible()

    // The post is one row seen by many, not a copy per person — and crucially
    // it did NOT touch the 1:1 Message table.
    const prisma = await makePrisma()
    try {
      const group = await prisma.messageGroup.findFirstOrThrow({ where: { name: { contains: tag } } })
      const posts = await prisma.groupMessage.findMany({ where: { groupId: group.id } })
      expect(posts).toHaveLength(1)
      expect(posts[0].visibility).toBe('EVERYONE')
      const leaked = await prisma.message.count({ where: { body: { contains: tag } } })
      expect(leaked).toBe(0)
    } finally {
      await prisma.$disconnect()
    }

    await cleanup(tag)
  })

  test('a broadcast reply reaches the trainer and no other client', async ({ page }) => {
    const tag = `E2E-GRPREPLY-${Date.now()}`
    const { groupId } = await seedGroup({
      tag,
      mode: 'BROADCAST',
      clientIds: [SEED.assignedClientId, SEED.unassignedClientId],
    })

    // The trainer asks something open-ended.
    const prisma = await makePrisma()
    let postId = ''
    try {
      const owner = await prisma.messageGroupParticipant.findFirstOrThrow({
        where: { groupId, role: 'OWNER' }, select: { userId: true },
      })
      const post = await prisma.groupMessage.create({
        data: { groupId, senderId: owner.userId, body: `${tag} what time suits everyone?`, visibility: 'EVERYONE' },
      })
      postId = post.id
      // The OTHER client answers. Written the way the API writes it.
      const other = await prisma.clientProfile.findUniqueOrThrow({
        where: { id: SEED.unassignedClientId }, select: { userId: true },
      })
      await prisma.groupMessage.create({
        data: {
          groupId, senderId: other.userId, replyToId: post.id,
          body: `${tag} SECRET-FROM-OTHER-CLIENT`, visibility: 'TRAINER_ONLY',
        },
      })
    } finally {
      await prisma.$disconnect()
    }

    // Our client opens the group. They must see the question, and must NOT see
    // the other client's answer.
    await login(page, SEED.client.email, SEED.client.password)
    await page.setViewportSize(PHONE)
    const asClient = await page.request.get(`/api/message-groups/${groupId}/messages`)
    expect(asClient.ok()).toBeTruthy()
    const clientView = await asClient.json()
    const bodies = clientView.messages.map((m: { body: string }) => m.body)
    expect(bodies).toContain(`${tag} what time suits everyone?`)
    expect(bodies.join(' ')).not.toContain('SECRET-FROM-OTHER-CLIENT')
    // And they are not told who else is in it.
    expect(clientView.participants).toEqual([])

    // The responses view is trainer-only — a client must not reach it at all.
    const forbidden = await page.request.get(`/api/message-groups/${groupId}/responses/${postId}`)
    expect(forbidden.status()).toBe(403)

    // Our client replies through the app.
    await page.goto(`/my-messages?group=${groupId}`)
    const composer = page.getByTestId('client-group-input')
    await expect(composer).toBeVisible({ timeout: 20_000 })
    await composer.fill(`${tag} Tuesday works for me`)
    await composer.press('Enter')

    await expect.poll(async () => {
      const p = await makePrisma()
      try {
        return await p.groupMessage.count({ where: { groupId, body: { contains: 'Tuesday works for me' } } })
      } finally { await p.$disconnect() }
    }, { timeout: 20_000 }).toBe(1)

    // It was written TRAINER_ONLY — that is the whole guarantee of the mode.
    const p2 = await makePrisma()
    try {
      const reply = await p2.groupMessage.findFirstOrThrow({
        where: { groupId, body: { contains: 'Tuesday works for me' } },
      })
      expect(reply.visibility).toBe('TRAINER_ONLY')
    } finally {
      await p2.$disconnect()
    }

    // The trainer sees both answers gathered against the question, and the
    // people who said nothing are listed too.
    await login(page, SEED.owner.email, SEED.owner.password)
    const res = await page.request.get(`/api/message-groups/${groupId}/responses/${postId}`)
    expect(res.ok()).toBeTruthy()
    const view = await res.json()
    expect(view.totalCount).toBe(2)
    expect(view.repliedCount).toBe(2)
    expect(JSON.stringify(view.rows)).toContain('SECRET-FROM-OTHER-CLIENT')

    await cleanup(tag)
  })

  test('a community group shows nothing until the client opts in', async ({ page }) => {
    const tag = `E2E-COMM-${Date.now()}`
    const { groupId } = await seedGroup({
      tag,
      mode: 'COMMUNITY',
      clientIds: [SEED.assignedClientId, SEED.unassignedClientId],
      joined: false,
    })

    const prisma = await makePrisma()
    try {
      const owner = await prisma.messageGroupParticipant.findFirstOrThrow({
        where: { groupId, role: 'OWNER' }, select: { userId: true },
      })
      await prisma.groupMessage.create({
        data: { groupId, senderId: owner.userId, body: `${tag} PRIVATE-COMMUNITY-CHATTER`, visibility: 'EVERYONE' },
      })
    } finally {
      await prisma.$disconnect()
    }

    await login(page, SEED.client.email, SEED.client.password)
    await page.setViewportSize(PHONE)

    // Not joined: no messages, no members, no posting. Opt-in is default OFF.
    const before = await page.request.get(`/api/message-groups/${groupId}/messages`)
    const beforeData = await before.json()
    expect(beforeData.group.joined).toBe(false)
    expect(beforeData.group.canPost).toBe(false)
    expect(beforeData.messages).toEqual([])
    expect(beforeData.participants).toEqual([])

    // The screen must say so, not silently show an empty thread.
    await page.goto(`/my-messages?group=${groupId}`)
    await expect(page.locator('body')).not.toContainText('PRIVATE-COMMUNITY-CHATTER')

    // Posting before consent is refused — otherwise they'd expose themselves
    // to the group without ever agreeing to be in it.
    const blocked = await page.request.post(`/api/message-groups/${groupId}/messages`, {
      data: { body: 'hello everyone' },
    })
    expect(blocked.status()).toBe(403)

    // Now they say yes.
    const joined = await page.request.post(`/api/message-groups/${groupId}/membership`, {
      data: { action: 'join' },
    })
    expect(joined.ok()).toBeTruthy()

    const after = await page.request.get(`/api/message-groups/${groupId}/messages`)
    const afterData = await after.json()
    expect(afterData.group.joined).toBe(true)
    expect(afterData.messages.map((m: { body: string }) => m.body)).toContain(`${tag} PRIVATE-COMMUNITY-CHATTER`)

    // Leaving sticks: optedOutAt is set, so a roster refresh can't drag them back.
    const left = await page.request.post(`/api/message-groups/${groupId}/membership`, {
      data: { action: 'leave' },
    })
    expect(left.ok()).toBeTruthy()
    const p2 = await makePrisma()
    try {
      const me = await p2.clientProfile.findUniqueOrThrow({
        where: { id: SEED.assignedClientId }, select: { userId: true },
      })
      const row = await p2.messageGroupParticipant.findFirstOrThrow({
        where: { groupId, userId: me.userId },
      })
      expect(row.leftAt).not.toBeNull()
      expect(row.optedOutAt).not.toBeNull()
    } finally {
      await p2.$disconnect()
    }

    // And once out, the group is gone for them entirely.
    const gone = await page.request.get(`/api/message-groups/${groupId}/messages`)
    expect(gone.status()).toBe(404)

    await cleanup(tag)
  })

  test('a trainer cannot reach another business’s group', async ({ page }) => {
    const tag = `E2E-XTENANT-${Date.now()}`
    const { groupId } = await seedGroup({
      tag,
      mode: 'BROADCAST',
      clientIds: [SEED.businessB.clientId],
    })

    const prisma = await makePrisma()
    let postId = ''
    try {
      const owner = await prisma.messageGroupParticipant.findFirstOrThrow({
        where: { groupId, role: 'OWNER' }, select: { userId: true },
      })
      const post = await prisma.groupMessage.create({
        data: { groupId, senderId: owner.userId, body: `${tag} RIVAL-ONLY-CONTENT`, visibility: 'EVERYONE' },
      })
      postId = post.id
    } finally {
      await prisma.$disconnect()
    }

    await login(page, SEED.owner.email, SEED.owner.password)

    // Reading, posting, moderating, and the responses view all 404.
    expect((await page.request.get(`/api/message-groups/${groupId}/messages`)).status()).toBe(404)
    expect((await page.request.post(`/api/message-groups/${groupId}/messages`, { data: { body: 'intruding' } })).status()).toBe(404)
    expect((await page.request.get(`/api/message-groups/${groupId}/responses/${postId}`)).status()).toBe(404)
    expect((await page.request.delete(`/api/message-groups/${groupId}`)).status()).toBe(404)
    expect((await page.request.delete(`/api/message-groups/${groupId}/messages/${postId}`)).status()).toBe(404)

    // Nothing leaked into the page either.
    await page.goto(`/messages?group=${groupId}`)
    await expect(page.locator('body')).not.toContainText('RIVAL-ONLY-CONTENT')

    // It all survived.
    const p2 = await makePrisma()
    try {
      expect(await p2.messageGroup.count({ where: { id: groupId } })).toBe(1)
      expect(await p2.groupMessage.count({ where: { id: postId, deletedAt: null } })).toBe(1)
    } finally {
      await p2.$disconnect()
    }

    // And a trainer cannot build a group out of another business's clients.
    const res = await page.request.post('/api/message-groups', {
      data: { mode: 'BROADCAST', scope: 'MANUAL', clientIds: [SEED.businessB.clientId], name: `${tag} probe` },
    })
    expect(res.status()).toBe(422)

    await cleanup(tag)
  })

  test('a client cannot reach a group they are not in', async ({ page }) => {
    const tag = `E2E-NOTMINE-${Date.now()}`
    const { groupId } = await seedGroup({
      tag,
      mode: 'BROADCAST',
      clientIds: [SEED.unassignedClientId],
    })

    await login(page, SEED.client.email, SEED.client.password)
    expect((await page.request.get(`/api/message-groups/${groupId}/messages`)).status()).toBe(404)
    expect((await page.request.post(`/api/message-groups/${groupId}/messages`, { data: { body: 'hi' } })).status()).toBe(404)
    // Membership actions on a group you're not in are refused too.
    expect((await page.request.post(`/api/message-groups/${groupId}/membership`, { data: { action: 'join' } })).status()).toBe(404)

    await cleanup(tag)
  })

  test('moderation removes a person and tombstones a post', async ({ page }) => {
    const tag = `E2E-MOD-${Date.now()}`
    const { groupId } = await seedGroup({
      tag,
      mode: 'COMMUNITY',
      clientIds: [SEED.assignedClientId, SEED.unassignedClientId],
      joined: true,
    })

    const prisma = await makePrisma()
    let postId = ''
    let participantId = ''
    try {
      const other = await prisma.clientProfile.findUniqueOrThrow({
        where: { id: SEED.unassignedClientId }, select: { userId: true },
      })
      const post = await prisma.groupMessage.create({
        data: { groupId, senderId: other.userId, body: `${tag} something out of line`, visibility: 'EVERYONE' },
      })
      postId = post.id
      participantId = (await prisma.messageGroupParticipant.findFirstOrThrow({
        where: { groupId, userId: other.userId }, select: { id: true },
      })).id
    } finally {
      await prisma.$disconnect()
    }

    await login(page, SEED.owner.email, SEED.owner.password)

    expect((await page.request.delete(`/api/message-groups/${groupId}/messages/${postId}`)).ok()).toBeTruthy()
    expect((await page.request.delete(`/api/message-groups/${groupId}/participants/${participantId}`)).ok()).toBeTruthy()

    const p2 = await makePrisma()
    try {
      // Tombstoned, not destroyed — a moderation decision stays auditable and
      // the thread doesn't silently rewrite itself.
      const post = await p2.groupMessage.findUniqueOrThrow({ where: { id: postId } })
      expect(post.deletedAt).not.toBeNull()
      // Removed AND opted out, so a roster resync can't quietly re-add them.
      const p = await p2.messageGroupParticipant.findUniqueOrThrow({ where: { id: participantId } })
      expect(p.leftAt).not.toBeNull()
      expect(p.optedOutAt).not.toBeNull()
    } finally {
      await p2.$disconnect()
    }

    // The removed post is gone from the thread, and the departed member is
    // never named to whoever is left.
    const view = await (await page.request.get(`/api/message-groups/${groupId}/messages`)).json()
    expect(JSON.stringify(view.messages)).not.toContain('something out of line')

    await cleanup(tag)
  })
})
