import { api, db, testEmail, registerLead, latestOtp, record, summary } from './lib'
async function main() {
  const rows = await db(`select u.email, round(extract(epoch from (p."trialEndsAt" - (now() at time zone 'UTC')))/86400.0, 2) as days
    from users u join trainer_profiles p on p."userId"=u.id where u.email like 'signupaudit.%' order by u."createdAt" desc limit 3`)
  rows.forEach(r => record('TRIAL(utc) ' + r.email, Math.round(Number(r.days)) === 10, `${r.days} days`))
  const email = testEmail('exp2')
  await registerLead(email)
  const otp = await latestOtp(email)
  await db(`update verification_tokens set expires = (now() at time zone 'UTC') - interval '1 hour' where identifier=$1`, [email])
  const r = await api('/api/auth/verify-email', { method:'POST', body: JSON.stringify({ email, code: otp }) })
  record('VER expired code rejected (utc)', r.status===400 && /expired/i.test(r.body?.error??''), `${r.status} ${r.body?.error}`)
  const v = await db(`select "emailVerified" from users where email=$1`,[email])
  record('VER expired did NOT verify user', v[0].emailVerified === null, `emailVerified=${v[0].emailVerified}`)
  summary()
}
main()
