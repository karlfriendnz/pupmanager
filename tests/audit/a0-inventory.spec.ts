import { test } from '@playwright/test'
import { tab } from './helpers'
const TABS = (process.env.TABS || 'design,notifications,configure,naming,addons,forms,locations,integrations,emails,team,billing,activity').split(',')
test('inventory', async ({ page }) => {
  test.setTimeout(300000)
  for (const t of TABS) {
    await tab(page, t)
    const info = await page.evaluate(() => {
      const out: any[] = []
      document.querySelectorAll('input,select,textarea,button,[role=switch],[contenteditable=true]').forEach(el => {
        const e = el as HTMLInputElement
        const r = e.getBoundingClientRect()
        if (r.width === 0 && r.height === 0) return
        if (e.closest('nav')) return
        let label = ''
        if (e.id) { const l = document.querySelector('label[for="' + CSS.escape(e.id) + '"]'); if (l) label = (l as HTMLElement).innerText }
        if (!label) { const l = e.closest('label'); if (l) label = (l as HTMLElement).innerText }
        if (!label) label = e.getAttribute('aria-label') || e.getAttribute('placeholder') || ''
        out.push({
          tag: e.tagName.toLowerCase(), type: e.type || e.getAttribute('role') || '',
          name: e.name || '',
          label: label.replace(/\s+/g, ' ').slice(0, 70),
          text: (e.tagName === 'BUTTON' ? (e as any).innerText : '').replace(/\s+/g, ' ').slice(0, 45),
          value: e.tagName === 'SELECT' ? (e as any).value : (e.type === 'checkbox' ? String(e.checked) : String(e.value ?? '').slice(0, 40)),
        })
      })
      return { count: out.length, controls: out, docW: document.documentElement.scrollWidth, winW: window.innerWidth, head: document.body.innerText.slice(0, 400) }
    })
    console.log(`===== TAB ${t} (${info.count}) scrollW=${info.docW}/${info.winW}`)
    console.log('   HEAD:', info.head.replace(/\n+/g, ' / ').slice(0, 300))
    for (const c of info.controls) console.log('  ', JSON.stringify(c))
  }
})
