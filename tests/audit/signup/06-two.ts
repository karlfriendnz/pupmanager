import { chromium } from 'playwright'
import { api, db, BASE, freshIp } from './lib'
const PW='AuditPass123!'
async function main(){
  const email=`twoaudit.${Date.now()}@pupaudit.test`
  await api('/api/auth/signup',{method:'POST',ip:freshIp(),body:JSON.stringify({name:'Two Tester',businessName:'Two Kennels',phone:'+64 21 555 0404',email,password:PW,signupCountry:'NZ'})})
  await db(`update users set "emailVerified" = now() at time zone 'UTC' where email=$1`,[email])
  const [p]=await db(`select p.id from trainer_profiles p join users u on u.id=p."userId" where u.email=$1`,[email])
  await db(`insert into trainer_onboarding_progress ("id","trainerId","welcomeShownAt","checklistDismissedAt","createdAt","updatedAt")
    values (gen_random_uuid(),$1, now() at time zone 'UTC', now() at time zone 'UTC', now() at time zone 'UTC', now() at time zone 'UTC')
    on conflict ("trainerId") do update set "welcomeShownAt"=excluded."welcomeShownAt","checklistDismissedAt"=excluded."checklistDismissedAt"`,[p.id])
  const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:1280,height:900},extraHTTPHeaders:{'x-forwarded-for':freshIp()}}); const pg=await ctx.newPage()
  await pg.goto(BASE+'/login',{waitUntil:'networkidle',timeout:90000})
  await pg.locator('input[type="email"]').fill(email); await pg.locator('input[type="password"]').fill(PW)
  for(let i=0;i<8;i++){ await pg.locator('button[type="submit"]').evaluate((el:any)=>el.click()).catch(()=>{})
    let ok=false; for(let j=0;j<12;j++){ await pg.waitForTimeout(1000); if(await pg.evaluate(()=>!location.pathname.startsWith('/login')).catch(()=>false)){ok=true;break} } if(ok)break }
  for(const r of ['/clients/invite','/schedule/route','/clients','/offerings','/progress','/messages']){
    const errs:string[]=[]; pg.on('pageerror',e=>errs.push(e.message.split('\n')[0]))
    let st=0
    try{ const resp=await pg.goto(BASE+r,{waitUntil:'domcontentloaded',timeout:60000}); st=resp?.status()??0 }catch(e:any){errs.push('NAV '+e.message.split('\n')[0])}
    await pg.waitForTimeout(4000)
    const info=await pg.evaluate(()=>({
      url:location.pathname,
      body:(document.body.innerText??'').replace(/\s+/g,' ').trim(),
      overlays:document.querySelectorAll('.fixed.inset-0').length,
    })).catch((e)=>({url:'EVALFAIL '+e.message.slice(0,80),body:'',overlays:-1}))
    console.log(`\n### ${r} http=${st} -> ${info.url} overlays=${info.overlays}`)
    console.log('  BODY:', info.body.slice(0,500))
    if(errs.length) console.log('  ERR:',[...new Set(errs)].slice(0,3).join(' | '))
  }
  await b.close()
}
main().catch(e=>console.error('ERR',e.message))
