import { type Page, expect } from '@playwright/test'
export const EMAIL = 'audit.settings@pupaudit.test'
export const PASSWORD = 'AuditSet2026!'

// Auth comes from the shared storageState (see global-setup.ts) — the dev
// server's login rate limit is per-IP and shared with the other audit agents,
// so we log in ONCE per run, not once per spec.
export async function login(_page: Page) { /* no-op: storageState */ }

export async function tab(page: Page, t: string) {
  await page.goto(`/settings?tab=${t}`, { waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.waitForTimeout(3000)
}

export async function clickText(page: Page, text: string, nth = 0) {
  const ok = await page.evaluate(([t, n]) => {
    const els = Array.from(document.querySelectorAll('button,a,[role=button]')) as HTMLElement[]
    const m = els.filter(e => e.innerText?.trim().includes(t as string) && e.offsetParent !== null)
    if (!m[n as number]) return false
    m[n as number].click(); return true
  }, [text, nth] as const)
  return ok
}
