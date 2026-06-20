import { describe, it, expect } from 'vitest'
import { sanitizeEmailHtml, emailBodyToHtml } from '../../../src/lib/email-html'

describe('sanitizeEmailHtml — strips dangerous markup from authored email HTML', () => {
  it('removes <script> blocks and their contents', () => {
    const out = sanitizeEmailHtml('<p>hi</p><script>steal()</script>')
    expect(out).not.toContain('<script')
    expect(out).not.toContain('steal()')
    expect(out).toContain('<p>hi</p>')
  })

  it('removes <iframe>, <object>, <svg> elements', () => {
    expect(sanitizeEmailHtml('<iframe src="evil"></iframe>')).not.toContain('<iframe')
    expect(sanitizeEmailHtml('<svg onload="x()"></svg>')).not.toContain('<svg')
    expect(sanitizeEmailHtml('<object data="x"></object>')).not.toContain('<object')
  })

  it('strips inline event handlers', () => {
    const out = sanitizeEmailHtml('<img src=x onerror="alert(1)">')
    expect(out.toLowerCase()).not.toContain('onerror')
  })

  it('neutralises javascript:/data: URLs in href/src', () => {
    const out = sanitizeEmailHtml('<a href="javascript:alert(1)">x</a>')
    expect(out).not.toContain('javascript:alert(1)')
  })

  it('keeps safe formatting tags and real links', () => {
    const out = sanitizeEmailHtml('<p>Hello <a href="https://pupmanager.com">site</a></p>')
    expect(out).toContain('<p>')
    expect(out).toContain('href="https://pupmanager.com"')
  })
})

describe('emailBodyToHtml — sanitises the HTML branch end-to-end', () => {
  it('a script injected into an HTML body does not survive rendering', () => {
    const out = emailBodyToHtml('<p>Welcome</p><script>document.cookie</script>')
    expect(out).not.toContain('<script')
    expect(out).not.toContain('document.cookie')
  })

  it('plain-text bodies are escaped, not interpreted as HTML', () => {
    const out = emailBodyToHtml('5 < 10 & "quoted"')
    expect(out).toContain('&lt;')
    expect(out).toContain('&amp;')
  })
})
