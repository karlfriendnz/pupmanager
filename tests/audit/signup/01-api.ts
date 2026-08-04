// Audit pass 1 — public surface + the signup/verify API contract.
// Run: npx tsx tests/audit/signup/01-api.ts
import { api, db, record, summary, testEmail, registerLead, latestOtp, freshIp } from './lib'

async function publicSurface() {
  const paths = [
    '/', '/welcome', '/login', '/register', '/signup', '/signup/client',
    '/forgot-password', '/reset-password', '/verify-account', '/verify-email',
    '/find-trainer', '/logout', '/invite',
  ]
  for (const p of paths) {
    const res = await fetch('http://localhost:7777' + p, { redirect: 'manual' })
    const loc = res.headers.get('location')
    record(`PUB ${p}`, res.status < 400, `${res.status}${loc ? ' -> ' + loc : ''}`)
  }
}

async function registerValidation() {
  const cases: [string, any, number][] = [
    ['empty body', {}, 400],
    ['short name', { name: 'A', businessName: 'Biz', phone: '+64211234567', email: testEmail('v1') }, 400],
    ['short business', { name: 'Alice B', businessName: 'B', phone: '+64211234567', email: testEmail('v2') }, 400],
    ['bad email', { name: 'Alice B', businessName: 'Biz Co', phone: '+64211234567', email: 'nope' }, 400],
    ['short phone', { name: 'Alice B', businessName: 'Biz Co', phone: '123', email: testEmail('v3') }, 400],
    ['phone w/ spaces+brackets', { name: 'Alice B', businessName: 'Biz Co', phone: '(09) 555 1234', email: testEmail('v4'), signupCountry: 'NZ' }, 201],
    ['5000-char name', { name: 'x'.repeat(5000), businessName: 'Biz Co', phone: '+64211234567', email: testEmail('v5'), signupCountry: 'NZ' }, 201],
    ['plus-addressed email', { name: 'Alice B', businessName: 'Biz Co', phone: '+64211234567', email: `signupaudit.plus+tag.${Date.now()}@pupaudit.test`, signupCountry: 'NZ' }, 201],
    ['bad country code', { name: 'Alice B', businessName: 'Biz Co', phone: '+64211234567', email: testEmail('v6'), signupCountry: 'NZL' }, 400],
    ['bad promo code', { name: 'Alice B', businessName: 'Biz Co', phone: '+64211234567', email: testEmail('v7'), signupCountry: 'NZ', promoCode: 'TOTALLY-FAKE' }, 400],
  ]
  for (const [label, body, want] of cases) {
    const r = await api('/api/auth/register', { method: 'POST', body: JSON.stringify(body) })
    record(`REG ${label}`, r.status === want, `got ${r.status} want ${want} :: ${JSON.stringify(r.body?.error ?? r.body).slice(0, 120)}`)
  }

  // 5000-char name actually stored?
  const long = await db(`select name, length(name) as n from users where name like 'xxxx%' order by "createdAt" desc limit 1`)
  record('REG 5000-char name stored', true, `stored length = ${long[0]?.n ?? 'none'} (no max length on name)`)
}

async function signupValidation() {
  const cases: [string, any, number][] = [
    ['empty body', {}, 400],
    ['7-char password', { name: 'Bob C', businessName: 'Biz Co', phone: '+64211234567', email: testEmail('s1'), password: 'short12', signupCountry: 'NZ' }, 400],
    ['valid', { name: 'Bob C', businessName: 'Biz Co', phone: '+64211234567', email: testEmail('s2'), password: 'AuditPass123!', signupCountry: 'NZ' }, 201],
    ['duplicate email', { name: 'Bob C', businessName: 'Biz Co', phone: '+64211234567', email: testEmail('s2'), password: 'AuditPass123!', signupCountry: 'NZ' }, 409],
    ['password = "password"', { name: 'Bob C', businessName: 'Biz Co', phone: '+64211234567', email: testEmail('s3'), password: 'password', signupCountry: 'NZ' }, 201],
  ]
  for (const [label, body, want] of cases) {
    const r = await api('/api/auth/signup', { method: 'POST', body: JSON.stringify(body) })
    record(`SIGNUP ${label}`, r.status === want, `got ${r.status} want ${want} :: ${JSON.stringify(r.body?.error ?? r.body).slice(0, 120)}`)
  }
}

async function trialLength() {
  const rows = await db(`
    select u.email, p."trialEndsAt", p."subscriptionStatus", p."signupCountry",
           round(extract(epoch from (p."trialEndsAt" - now()))/86400.0) as days
    from users u join trainer_profiles p on p."userId" = u.id
    where u.email like 'signupaudit.%' order by u."createdAt" desc limit 5`)
  for (const r of rows) {
    record(`TRIAL ${r.email}`, Number(r.days) === 10, `${r.days} days, status=${r.subscriptionStatus}, country=${r.signupCountry}`)
  }
}

async function verification() {
  const email = testEmail('verify')
  await registerLead(email)
  const otp = await latestOtp(email)
  record('VER otp issued', !!otp && /^\d{6}$/.test(otp!), `otp=${otp}`)

  // Tampered code
  let r = await api('/api/auth/verify-email', { method: 'POST', body: JSON.stringify({ email, code: '000000' === otp ? '111111' : '000000' }) })
  record('VER wrong code rejected', r.status === 400, `${r.status} ${r.body?.error}`)

  // Non-6-digit
  r = await api('/api/auth/verify-email', { method: 'POST', body: JSON.stringify({ email, code: 'abcdef' }) })
  record('VER non-numeric rejected', r.status === 400, `${r.status} ${r.body?.error}`)

  // BRUTE FORCE probe — is verify-email rate limited at all?
  const t0 = Date.now()
  let sawLimit = false
  for (let i = 0; i < 30; i++) {
    const rr = await api('/api/auth/verify-email', {
      method: 'POST', ip: '10.66.66.66',
      body: JSON.stringify({ email, code: String(100000 + i) }),
    })
    if (rr.status === 429) { sawLimit = true; break }
  }
  record('VER brute-force limited', sawLimit, sawLimit ? 'got 429' : `30 wrong codes from ONE ip in ${Date.now() - t0}ms, all 400 — NO rate limit on /api/auth/verify-email`)

  // Correct code
  r = await api('/api/auth/verify-email', { method: 'POST', body: JSON.stringify({ email, code: otp }) })
  record('VER correct code works', r.status === 200 && r.body?.ok, `${r.status} needsPassword=${r.body?.needsPassword} token=${r.body?.setupToken ? 'yes' : 'no'}`)
  const setupToken = r.body?.setupToken

  // Reuse the same code
  r = await api('/api/auth/verify-email', { method: 'POST', body: JSON.stringify({ email, code: otp }) })
  record('VER code reuse rejected', r.status === 400, `${r.status} ${r.body?.error}`)

  // set-password with a tampered token
  r = await api('/api/auth/set-password', { method: 'POST', body: JSON.stringify({ email, token: 'not-a-token', password: 'AuditPass123!' }) })
  record('VER setup token tamper rejected', r.status === 400, `${r.status} ${r.body?.error}`)

  // set-password with someone else's token? mint a second lead
  const email2 = testEmail('verify2')
  await registerLead(email2)
  const otp2 = await latestOtp(email2)
  const r2 = await api('/api/auth/verify-email', { method: 'POST', body: JSON.stringify({ email: email2, code: otp2 }) })
  const token2 = r2.body?.setupToken
  r = await api('/api/auth/set-password', { method: 'POST', body: JSON.stringify({ email, token: token2, password: 'AuditPass123!' }) })
  record('VER cross-account setup token rejected', r.status === 400, `${r.status} ${r.body?.error}`)

  // legit set-password
  r = await api('/api/auth/set-password', { method: 'POST', body: JSON.stringify({ email, token: setupToken, password: 'AuditPass123!' }) })
  record('VER set-password works', r.status === 200, `${r.status} ${JSON.stringify(r.body).slice(0, 80)}`)

  // reuse the setup token
  r = await api('/api/auth/set-password', { method: 'POST', body: JSON.stringify({ email, token: setupToken, password: 'Different123!' }) })
  record('VER setup token single-use', r.status === 400, `${r.status} ${r.body?.error}`)

  // EXPIRED code path
  const email3 = testEmail('expired')
  await registerLead(email3)
  const otp3 = await latestOtp(email3)
  await db(`update verification_tokens set expires = now() - interval '1 hour' where identifier = $1`, [email3])
  r = await api('/api/auth/verify-email', { method: 'POST', body: JSON.stringify({ email: email3, code: otp3 }) })
  record('VER expired code rejected', r.status === 400 && /expired/i.test(r.body?.error ?? ''), `${r.status} ${r.body?.error}`)
  const left = await db(`select count(*)::int c from verification_tokens where identifier = $1`, [email3])
  record('VER expired code cleaned up', left[0].c === 0, `${left[0].c} rows left`)

  // resend-verification: does it enumerate?
  const unknown = await api('/api/auth/resend-verification', { method: 'POST', body: JSON.stringify({ email: 'nobody.here@pupaudit.test' }) })
  const known = await api('/api/auth/resend-verification', { method: 'POST', body: JSON.stringify({ email: email3 }) })
  record('VER resend does not enumerate', unknown.status === known.status && unknown.text === known.text, `unknown=${unknown.status}/${unknown.text} known=${known.status}/${known.text}`)

  // Multiple registers for the SAME email — register 409s, but does an
  // unverified lead accumulate tokens?
  const tokRows = await db(`select count(*)::int c from verification_tokens where identifier = $1`, [email3])
  record('VER token table after resend', true, `${tokRows[0].c} live token(s) for one lead`)
}

async function rateLimits() {
  const ip = '10.77.77.77'
  let sawLimit = false
  for (let i = 0; i < 8; i++) {
    const r = await api('/api/auth/register', {
      method: 'POST', ip,
      body: JSON.stringify({ name: 'RL Test', businessName: 'RL Biz', phone: '+64211234567', email: testEmail('rl' + i), signupCountry: 'NZ' }),
    })
    if (r.status === 429) { sawLimit = true; record('RL register limited', true, `429 at attempt ${i + 1}`); break }
  }
  if (!sawLimit) record('RL register limited', false, '8 registrations from one IP, no 429')

  // forgot-password enumeration
  const a = await api('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email: 'nobody.here@pupaudit.test' }) })
  const b = await api('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email: 'trainer@demo.co.nz' }) })
  record('RESET does not enumerate', a.status === b.status && a.text === b.text, `unknown=${a.status}/${a.text.slice(0, 60)} known=${b.status}/${b.text.slice(0, 60)}`)
}

async function verifiedUserCanLogInWithoutPassword() {
  // A /register lead that verified but never set a password: can it log in?
  const email = testEmail('nopw')
  await registerLead(email)
  const otp = await latestOtp(email)
  await api('/api/auth/verify-email', { method: 'POST', body: JSON.stringify({ email, code: otp }) })
  const accounts = await db(`select count(*)::int c from accounts a join users u on u.id=a."userId" where u.email=$1`, [email])
  record('LEAD verified-but-passwordless', accounts[0].c === 0, `${accounts[0].c} credential account(s) — expected 0, login must be impossible`)
}

async function main() {
  console.log('--- public surface ---'); await publicSurface()
  console.log('\n--- /api/auth/register validation ---'); await registerValidation()
  console.log('\n--- /api/auth/signup validation ---'); await signupValidation()
  console.log('\n--- trial length ---'); await trialLength()
  console.log('\n--- verification ---'); await verification()
  console.log('\n--- rate limits ---'); await rateLimits()
  console.log('\n--- passwordless lead ---'); await verifiedUserCanLogInWithoutPassword()
  summary()
}
main().catch(e => { console.error(e); process.exit(1) })
