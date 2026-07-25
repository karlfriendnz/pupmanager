import { describe, it, expect } from 'vitest'
import { sanitizeRichHtml, isRichTextEmpty, richTextToPlain } from '@/lib/rich-text'

// sanitizeRichHtml is the XSS boundary for every trainer-authored description
// rendered to clients/public. It must keep the editor's formatting and drop
// everything dangerous.
describe('sanitizeRichHtml', () => {
  it('keeps the editor’s allowed tags', () => {
    const html = '<h2>Title</h2><p><strong>Bold</strong> and <em>italic</em></p><ul><li>one</li><li>two</li></ul>'
    expect(sanitizeRichHtml(html)).toBe(html)
  })

  it('strips <script> entirely', () => {
    expect(sanitizeRichHtml('<p>hi</p><script>alert(1)</script>')).toBe('<p>hi</p>')
  })

  it('strips inline event handlers', () => {
    const out = sanitizeRichHtml('<p onclick="steal()">click</p>')
    expect(out).toBe('<p>click</p>')
    expect(out).not.toContain('onclick')
  })

  it('drops javascript: links but keeps http/mailto', () => {
    expect(sanitizeRichHtml('<a href="javascript:alert(1)">x</a>')).not.toContain('javascript:')
    const safe = sanitizeRichHtml('<a href="https://example.com">x</a>')
    expect(safe).toContain('href="https://example.com"')
    expect(safe).toContain('rel="noopener noreferrer nofollow"')
    expect(safe).toContain('target="_blank"')
  })

  it('strips images, iframes and style tags', () => {
    expect(sanitizeRichHtml('<img src=x onerror=alert(1)>')).toBe('')
    expect(sanitizeRichHtml('<iframe src="evil"></iframe>')).toBe('')
    expect(sanitizeRichHtml('<style>body{}</style><p>ok</p>')).toBe('<p>ok</p>')
  })

  it('keeps a text-colour span (hex, rgb, named)', () => {
    expect(sanitizeRichHtml('<p><span style="color:#ef4444">red</span></p>')).toBe('<p><span style="color:#ef4444">red</span></p>')
    expect(sanitizeRichHtml('<span style="color:rgb(255, 0, 0)">x</span>')).toContain('color:rgb(255, 0, 0)')
    expect(sanitizeRichHtml('<span style="color:red">x</span>')).toContain('color:red')
  })

  it('drops any non-colour style riding on the span', () => {
    const out = sanitizeRichHtml('<span style="color:#ef4444;position:fixed;top:0">x</span>')
    expect(out).toContain('color:#ef4444')
    expect(out).not.toContain('position')
    expect(out).not.toContain('top')
  })

  it('strips a url()/expression colour value', () => {
    const out = sanitizeRichHtml('<span style="color:url(javascript:alert(1))">x</span>')
    expect(out).not.toContain('url(')
    expect(out).not.toContain('javascript')
  })

  it('passes plain text through unchanged (legacy descriptions stay safe)', () => {
    expect(sanitizeRichHtml('Just a plain description')).toBe('Just a plain description')
  })

  it('handles null/undefined', () => {
    expect(sanitizeRichHtml(null)).toBe('')
    expect(sanitizeRichHtml(undefined)).toBe('')
  })
})

describe('isRichTextEmpty', () => {
  it('treats empty document / whitespace as empty', () => {
    expect(isRichTextEmpty(null)).toBe(true)
    expect(isRichTextEmpty('')).toBe(true)
    expect(isRichTextEmpty('<p></p>')).toBe(true)
    expect(isRichTextEmpty('<p>   </p>')).toBe(true)
    expect(isRichTextEmpty('<p>&nbsp;</p>')).toBe(true)
  })

  it('is false when there is visible content', () => {
    expect(isRichTextEmpty('<p>hi</p>')).toBe(false)
  })
})

describe('richTextToPlain', () => {
  it('strips tags and keeps readable line breaks', () => {
    const out = richTextToPlain('<h2>Plan</h2><p>Week one</p><ul><li>Sit</li><li>Stay</li></ul>')
    expect(out).toContain('Plan')
    expect(out).toContain('Week one')
    expect(out).toContain('- Sit')
    expect(out).toContain('- Stay')
    expect(out).not.toContain('<')
  })
})
