import { describe, it, expect, vi, beforeEach } from 'vitest'

// A customer reported the Google Calendar connection "hanging". It never hung.
// Every failure in the flow redirected to the SAME `?googlecalendar=error`, on
// a page that rendered no message for it — so the trainer clicked Connect, went
// to Google, came back, and landed on a page identical to the one they left.
// Five different causes, all indistinguishable, none of them reportable.
//
// These tests pin the thing that makes it diagnosable: every exit names itself.
// The wording of the message is not the contract; the reason code is, because
// that is what turns "it hangs" into "it says expired".

const h = vi.hoisted(() => ({
  tokenFindFirst: vi.fn(),
  tokenDelete: vi.fn(),
  membershipFindUnique: vi.fn(),
  connUpsert: vi.fn(),
  exchange: vi.fn(),
  refreshBusy: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    verificationToken: { findFirst: h.tokenFindFirst, delete: h.tokenDelete },
    trainerMembership: { findUnique: h.membershipFindUnique },
    googleCalendarConnection: { upsert: h.connUpsert },
  },
}))
vi.mock('@/lib/google-calendar', () => ({ exchangeCodeForTokens: h.exchange }))
vi.mock('@/lib/google-calendar-sync', () => ({ refreshBusyForMembership: h.refreshBusy }))

import { GET } from '@/app/api/google-calendar/callback/route'

const APP = 'https://app.pupmanager.com'
const call = (qs: string) => GET(new Request(`${APP}/api/google-calendar/callback?${qs}`))

/** The `googlecalendar=` reason on the Location header. */
async function reasonFrom(res: Response): Promise<string | null> {
  const loc = res.headers.get('location') ?? ''
  return new URL(loc).searchParams.get('googlecalendar')
}

const GOOD_STATE = { identifier: 'gcal-oauth:mem_1', token: 'st' }

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_APP_URL = APP
  h.tokenFindFirst.mockResolvedValue(GOOD_STATE)
  h.tokenDelete.mockResolvedValue({})
  h.membershipFindUnique.mockResolvedValue({ companyId: 'co_1' })
  h.exchange.mockResolvedValue({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 })
  h.connUpsert.mockResolvedValue({})
  h.refreshBusy.mockResolvedValue(undefined)
})

describe('every way the Google connect can fail says which one it was', () => {
  it('the trainer declined on Google', async () => {
    expect(await reasonFrom(await call('error=access_denied&state=st'))).toBe('denied')
  })

  it('Google reported some other problem', async () => {
    expect(await reasonFrom(await call('error=server_error&state=st'))).toBe('google')
  })

  it('Google sent us back with no code', async () => {
    expect(await reasonFrom(await call('state=st'))).toBe('nocode')
  })

  it('the sign-in sat too long and the state expired', async () => {
    // The likeliest real cause of a "hang" report: the trainer left the tab open
    // past the ten-minute window.
    h.tokenFindFirst.mockResolvedValue(null)
    expect(await reasonFrom(await call('code=c&state=st'))).toBe('expired')
  })

  it('the membership behind the state is gone', async () => {
    h.membershipFindUnique.mockResolvedValue(null)
    expect(await reasonFrom(await call('code=c&state=st'))).toBe('nomember')
  })

  it('Google returned no refresh token', async () => {
    // Happens when the account already granted this client, which every trainer
    // who signs in with Google has. Distinct from the rest because the fix is
    // the trainer revoking access, not us changing anything.
    h.exchange.mockResolvedValue({ access_token: 'at', expires_in: 3600 })
    expect(await reasonFrom(await call('code=c&state=st'))).toBe('norefresh')
  })

  it('the token exchange itself was rejected', async () => {
    // redirect_uri_mismatch lands here — a console misconfiguration on our side.
    h.exchange.mockRejectedValue(new Error('redirect_uri_mismatch'))
    expect(await reasonFrom(await call('code=c&state=st'))).toBe('exchange')
  })

  it('no two failures share a reason', async () => {
    // The whole defect was five causes wearing one label.
    const seen = [
      await reasonFrom(await call('error=access_denied&state=st')),
      await reasonFrom(await call('state=st')),
    ]
    h.tokenFindFirst.mockResolvedValue(null)
    seen.push(await reasonFrom(await call('code=c&state=st')))
    expect(new Set(seen).size).toBe(seen.length)
  })

  it('lands on the Calendar settings tab, which is the page that explains it', async () => {
    h.tokenFindFirst.mockResolvedValue(null)
    const loc = (await call('code=c&state=st')).headers.get('location')!
    expect(loc).toContain('/settings')
    expect(new URL(loc).searchParams.get('tab')).toBe('calendar')
  })
})

describe('the success path still works', () => {
  it('stores the connection and reports connected', async () => {
    const res = await call('code=c&state=st')
    expect(h.connUpsert).toHaveBeenCalledOnce()
    expect(await reasonFrom(res)).toBe('connected')
  })

  it('a failed initial busy refresh does NOT undo a good connect', async () => {
    h.refreshBusy.mockRejectedValue(new Error('calendar api disabled'))
    const res = await call('code=c&state=st')
    expect(h.connUpsert).toHaveBeenCalledOnce()
    expect(await reasonFrom(res)).toBe('connected')
  })

  it('honours a same-origin returnTo', async () => {
    const back = Buffer.from('/schedule').toString('base64url')
    h.tokenFindFirst.mockResolvedValue({ identifier: `gcal-oauth:mem_1:${back}`, token: 'st' })
    const loc = (await call('code=c&state=st')).headers.get('location')!
    expect(new URL(loc).pathname).toBe('/schedule')
    expect(new URL(loc).searchParams.get('googlecalendar')).toBe('connected')
  })

  it('refuses an off-site returnTo', async () => {
    const evil = Buffer.from('//evil.example.com/steal').toString('base64url')
    h.tokenFindFirst.mockResolvedValue({ identifier: `gcal-oauth:mem_1:${evil}`, token: 'st' })
    const loc = (await call('code=c&state=st')).headers.get('location')!
    expect(new URL(loc).host).toBe('app.pupmanager.com')
  })
})
