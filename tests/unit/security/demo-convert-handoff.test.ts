import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * "Start my own account", tapped from inside a demo.
 *
 * The sandbox is NEVER converted or kept. This is a way OUT: it ends the demo,
 * destroys the tenant, and hands the browser nothing but a pointer to the lead
 * so the real sign-up form can fill itself in.
 *
 * Three things have to hold, and each one is a way this could go wrong:
 *
 *   1. The demo tenant is destroyed BEFORE the browser goes anywhere near
 *      /register — they are signed in as a demo trainer when they tap, and
 *      arriving at sign-up still holding that session is the trap.
 *   2. ABANDONING the sign-up must still leave the sandbox swept. Most people
 *      who tap this will wander off mid-form.
 *   3. The account they create afterwards carries NO demo marker. One leaking
 *      onto a real business would put a paying customer in front of the purge
 *      cron.
 */

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  demoSessionFindUnique: vi.fn(),
  demoSessionUpdateMany: vi.fn(),
  leadUpdateMany: vi.fn(),
  leadDelete: vi.fn(),
  leadDeleteMany: vi.fn(),
  purgeDemoTenant: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    demoSession: { findUnique: h.demoSessionFindUnique, updateMany: h.demoSessionUpdateMany },
    demoLead: { updateMany: h.leadUpdateMany, delete: h.leadDelete, deleteMany: h.leadDeleteMany },
  },
}))
vi.mock('@/lib/demo-tenant', async () => {
  const actual = await vi.importActual<typeof import('@/lib/demo-tenant')>('@/lib/demo-tenant')
  return { ...actual, purgeDemoTenant: h.purgeDemoTenant }
})

import { POST as convert } from '@/app/api/try/convert/route'
import { NotADemoTenantError } from '@/lib/demo-tenant'
import { TRY_CONVERT_COPY } from '@/lib/demo-consent'
import { TRY_PREFILL_COOKIE, TRY_LEAD_COOKIE, TRY_PREFILL_MAX_AGE } from '@/lib/demo-lead'

const DEMO_SESSION = { user: { id: 'u-demo', trainerId: 't-demo', isDemo: true } }

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset()
  h.auth.mockResolvedValue(DEMO_SESSION)
  h.demoSessionFindUnique.mockResolvedValue({ id: 'ds-1', leadId: 'lead-1' })
  h.demoSessionUpdateMany.mockResolvedValue({ count: 1 })
  h.leadUpdateMany.mockResolvedValue({ count: 1 })
  h.purgeDemoTenant.mockResolvedValue({ trainerId: 't-demo', clientUsersDeleted: 3 })
})

describe('the copy says what is lost, before they commit', () => {
  it('names the practice data as NOT coming with them', () => {
    // The one thing this wording must do. A trainer who signs up expecting the
    // week they just built and finds an empty account is a trainer who decides
    // we are not careful people.
    expect(TRY_CONVERT_COPY.warning).toMatch(/do not come with you/i)
    expect(TRY_CONVERT_COPY.warning).toMatch(/empty account/i)
  })

  it('says what IS carried over, so the promise is specific', () => {
    expect(TRY_CONVERT_COPY.reassurance).toMatch(/name, business name and email/i)
  })

  it('never implies anything else carries over', () => {
    const all = Object.values(TRY_CONVERT_COPY).join(' ').toLowerCase()
    expect(all).not.toMatch(/keep your|carry over your data|transfer your|save your work/)
  })
})

describe('POST /api/try/convert — who may call it', () => {
  it('refuses an unauthenticated caller', async () => {
    h.auth.mockResolvedValue(null)
    const res = await convert()
    expect(res.status).toBe(401)
    expect(h.purgeDemoTenant).not.toHaveBeenCalled()
  })

  it('refuses a REAL trainer — this is not a self-delete button', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u-real', trainerId: 't-real' } })
    const res = await convert()
    expect(res.status).toBe(403)
    expect(h.purgeDemoTenant).not.toHaveBeenCalled()
  })

  it('refuses when the session says demo and the tenant disagrees', async () => {
    // Not waved through just because the visitor is on their way to buying.
    h.purgeDemoTenant.mockRejectedValue(new NotADemoTenantError('t-demo', 'demoSessionId is not set'))
    const res = await convert()
    expect(res.status).toBe(403)
  })
})

describe('POST /api/try/convert — the hand-off', () => {
  it('destroys the tenant named by the SESSION', async () => {
    const res = await convert()
    expect(res.status).toBe(200)
    expect(h.purgeDemoTenant.mock.calls[0][1]).toBe('t-demo')
  })

  it('records the intent BEFORE anything destructive', async () => {
    await convert()
    expect(h.leadUpdateMany.mock.invocationCallOrder[0])
      .toBeLessThan(h.purgeDemoTenant.mock.invocationCallOrder[0])
  })

  it('lets the FIRST tap win, so the timestamp means "when they decided"', async () => {
    await convert()
    const call = h.leadUpdateMany.mock.calls[0][0]
    expect(call.where).toEqual({ id: 'lead-1', startedSignupAt: null })
    expect(call.data.startedSignupAt).toBeInstanceOf(Date)
  })

  it('flags the visit for follow-up even though the sign-up has not happened yet', async () => {
    await convert()
    const data = h.demoSessionUpdateMany.mock.calls[0][0].data
    expect(data.status).toBe('ENDED')
    expect(data.wantsFollowUp).toBe(true)
  })

  it('hands the browser a POINTER to the lead, httpOnly and short-lived — never the details', async () => {
    const res = await convert()
    const cookies = res.headers.getSetCookie().join('\n')
    expect(cookies).toContain(`${TRY_PREFILL_COOKIE}=lead-1`)
    expect(cookies.toLowerCase()).toContain('httponly')
    // No name, business or email travelling in a header or a URL.
    expect(cookies).not.toMatch(/@/)
    expect(TRY_PREFILL_MAX_AGE).toBeLessThanOrEqual(60 * 30)
  })

  it('clears the cookie that could start another sandbox', async () => {
    const res = await convert()
    const cookies = res.headers.getSetCookie().join('\n')
    expect(cookies).toMatch(new RegExp(`${TRY_LEAD_COOKIE}=;`))
  })

  it('NEVER deletes the lead — it is the whole point of the exercise', async () => {
    await convert()
    expect(h.leadDelete).not.toHaveBeenCalled()
    expect(h.leadDeleteMany).not.toHaveBeenCalled()
  })
})

describe('abandoning the sign-up', () => {
  it('has already destroyed the sandbox by the time they wander off', async () => {
    // The tenant is destroyed HERE, not on the far side of a form nobody may
    // finish. Tapping Start and never signing up leaves nothing behind.
    const res = await convert()
    expect(await res.json()).toMatchObject({ ok: true, purged: true })
    expect(h.purgeDemoTenant).toHaveBeenCalledTimes(1)
  })

  it('leaves an ENDED visit for the sweep when the purge itself fails', async () => {
    // The other abandon case: they tap, the delete falls over, they walk away.
    // The visit was marked ENDED before the delete was attempted, and
    // /api/cron/purge-demo collects every ENDED row — so the sandbox still goes.
    h.purgeDemoTenant.mockRejectedValue(new Error('deadlock'))
    const res = await convert()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, purged: false })
    expect(h.demoSessionUpdateMany.mock.calls[0][0].data.status).toBe('ENDED')
  })
})
