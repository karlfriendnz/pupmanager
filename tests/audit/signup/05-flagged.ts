// Look closely at the routes the empty-state sweep flagged.
import { chromium } from 'playwright'
import { api, db, BASE, freshIp } from './lib'
const PW='AuditPass123!'
const ROUTES = process.argv.slice(2)
async function main(){
  const email=`flagaudit.${Date.now()}@pupaudit.test`
  await api('/api/auth/signup',{method:'POST',ip:freshIp(),body:JSON.stringify({name:'Flag Tester',businessName:'Flag Kennels',phone:'+64 21 555 0303',email,password:PW,signupCountry:'NZ'})})
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
  for(const r of ROUTES){
    const errs:string[]=[]; const onE=(e:Error)=>errs.push(e.message.split('\n')[0]); pg.on('pageerror',onE)
    let st=0
    try{ const resp=await pg.goto(BASE+r,{waitUntil:'domcontentloaded',timeout:60000}); st=resp?.status()??0; await pg.waitForTimeout(3000) }catch(e:any){ errs.push('NAV '+e.message.split('\n')[0]) }
    const info=await pg.evaluate(()=>({
      url: location.pathname+location.search,
      main:(document.querySelector('main')?.innerText??'').replace(/\s+/g,' ').trim(),
      h1:[...document.querySelectorAll('h1,h2')].map(x=>x.textContent?.trim()).slice(0,4),
    })).catch(()=>({url:'?',main:'EVAL FAILED',h1:[]}))
    pg.off('pageerror',onE)
    console.log(`\n### ${r}  http=${st} -> ${info.url}`)
    console.log(`  headings: ${JSON.stringify(info.h1)}`)
    console.log(`  main(${info.main.length}): ${info.main.slice(0,400)}`)
    if(errs.length) console.log(`  ERRORS: ${[...new Set(errs)].slice(0,3).join(' | ')}`)
  }
  await b.close()
}
main().catch(e=>console.error('ERR',e.message))
