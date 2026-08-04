import { describe, it, expect } from 'vitest'
import { sanitizeEmailHtml, emailBodyToHtml } from '@/lib/email-html'
import { sanitizeRichHtml, richTextToPlain, isRichTextEmpty } from '@/lib/rich-text'

// Security audit (2026-08) — attribute-delimiter bypasses of the REGEX email
// sanitizer, and the allowlist sanitizer that is immune to all of them.
//
// `sanitizeEmailHtml` strips event handlers with `/\son[a-z]+\s*=/` — i.e. it
// only recognises a handler preceded by WHITESPACE. HTML parsers accept `/` and
// comment-ish junk as attribute separators just as happily, so `<img/onerror=…>`
// walks straight through. It also only checks `href` and `src` for dangerous
// schemes, so `formaction` is unchecked.
//
// Where it lands: `emailBodyToHtml` (which wraps it) renders through
// dangerouslySetInnerHTML in the trainer's enquiry thread, the email-template
// preview and the admin announcement/onboarding previews, and its output is
// SENT as live HTML mail. Authoring is trainer/admin-only, so the practical
// blast radius is self-XSS plus HTML injection into outbound mail — but the
// sanitizer is the boundary and it does not hold.
//
// The four `test.fail`-style cases below assert the CORRECT behaviour, so they
// go green the moment `sanitizeEmailHtml` is replaced with the allowlist pass
// (`sanitize-html`, as `sanitizeRichHtml` already uses). They are skipped for
// now so the suite stays green — remove the `.skip` with the fix.

describe('sanitizeEmailHtml — attribute-delimiter bypasses (KNOWN OPEN)', () => {
  it.skip('a slash-delimited event handler survives (fix: allowlist sanitizer)', () => {
    const out = sanitizeEmailHtml('<p>x</p><img/src=y/onerror=alert(1)>')
    expect(out.toLowerCase()).not.toContain('onerror')
  })

  it.skip('a comment-delimited event handler survives (fix: allowlist sanitizer)', () => {
    const out = sanitizeEmailHtml('<p>x</p><img src=y/**/onerror=alert(1)>')
    expect(out.toLowerCase()).not.toContain('onerror')
  })

  it.skip('<details ontoggle> survives — details is not in the drop list', () => {
    const out = sanitizeEmailHtml('<p>x</p><details/open/ontoggle=alert(1)>')
    expect(out.toLowerCase()).not.toContain('ontoggle')
  })

  it.skip('formaction is never scheme-checked (only href/src are)', () => {
    const out = sanitizeEmailHtml('<form><button formaction=javascript:alert(1)>x</button></form>')
    expect(out.toLowerCase()).not.toContain('javascript:')
  })

  // These pin the CURRENT behaviour so the finding stays visible and the fix is
  // detectable. If one of these starts failing, the bypass was closed — delete
  // it and un-skip its partner above.
  it('documents the live bypass so it cannot be forgotten', () => {
    expect(sanitizeEmailHtml('<img/src=y/onerror=alert(1)>').toLowerCase()).toContain('onerror')
    expect(sanitizeEmailHtml('<img src=y/**/onerror=alert(1)>').toLowerCase()).toContain('onerror')
    expect(sanitizeEmailHtml('<details/open/ontoggle=alert(1)>').toLowerCase()).toContain('ontoggle')
    expect(sanitizeEmailHtml('<button formaction=javascript:alert(1)>x</button>').toLowerCase()).toContain('javascript:')
  })

  it('the whitespace-delimited forms it WAS written for still hold', () => {
    expect(sanitizeEmailHtml('<img src=y onerror=alert(1)>').toLowerCase()).not.toContain('onerror')
    expect(sanitizeEmailHtml('<img src=y onerror="alert(1)">').toLowerCase()).not.toContain('onerror')
    expect(sanitizeEmailHtml("<img src=y onerror='alert(1)'>").toLowerCase()).not.toContain('onerror')
  })

  it('emailBodyToHtml inherits the same hole through its HTML branch', () => {
    // Present so the blast radius is documented next to the primitive.
    const out = emailBodyToHtml('<p>hello</p><img/src=y/onerror=alert(1)>')
    expect(out.toLowerCase()).toContain('onerror')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The allowlist sanitizer — the one that guards trainer→client rich text. It is
// the boundary that actually matters (descriptions, library items, form
// questions, session notes all render to clients through <RichText/>), and it
// holds against every payload above plus the usual catalogue. Keep it that way.
// ─────────────────────────────────────────────────────────────────────────────
describe('sanitizeRichHtml — the trainer→client XSS boundary holds', () => {
  const PAYLOADS = [
    '<script>alert(1)</script>',
    '<p>ok</p><script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '<img/src=x/onerror=alert(1)>',
    '<img src=x/**/onerror=alert(1)>',
    '<details/open/ontoggle=alert(1)>',
    '<svg/onload=alert(1)>',
    '<svg><foreignObject><script>alert(1)</script></foreignObject></svg>',
    '<iframe src="javascript:alert(1)"></iframe>',
    '<iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"></iframe>',
    '<body onload=alert(1)>',
    '<form><button formaction=javascript:alert(1)>go</button></form>',
    '<object data="javascript:alert(1)"></object>',
    '<embed src="javascript:alert(1)">',
    '<math><mtext><script>alert(1)</script></mtext></math>',
    '<a href="javascript:alert(1)">click</a>',
    '<a href="JaVaScRiPt:alert(1)">click</a>',
    '<a href="java&#9;script:alert(1)">click</a>',
    '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">click</a>',
    '<a href="vbscript:msgbox(1)">click</a>',
    '<a href="//evil.test/x" target="_self">click</a>',
    '<base href="https://evil.test/">',
    '<link rel=stylesheet href="https://evil.test/x.css">',
    '<style>body{background:url(https://evil.test/leak)}</style>',
    '<span style="background:url(javascript:alert(1))">x</span>',
    '<span style="expression(alert(1))">x</span>',
    '<p onmouseover=alert(1)>hover</p>',
    '<scr<script>ipt>alert(1)</script>',
    '<textarea><img src=x onerror=alert(1)></textarea>',
    '<noscript><p title="</noscript><img src=x onerror=alert(1)>">',
  ]

  // Tags the editor may author. Anything else surviving as a LIVE tag is a hole.
  const ALLOWED = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'h2', 'h3', 'ul', 'ol', 'li', 'a', 'blockquote', 'code', 'pre', 'span'])

  /** Every live tag left in the output, as `{name, raw}`. Escaped text is not a tag. */
  function liveTags(html: string) {
    return [...html.matchAll(/<\s*\/?\s*([a-z][a-z0-9]*)([^>]*)>/gi)].map(m => ({
      name: m[1].toLowerCase(),
      raw: m[0].toLowerCase(),
    }))
  }

  it.each(PAYLOADS)('neutralises %s', payload => {
    const out = sanitizeRichHtml(payload)
    const lower = out.toLowerCase()

    // 1. Nothing outside the editor's own vocabulary survives as markup.
    for (const tag of liveTags(out)) {
      expect(ALLOWED.has(tag.name), `tag <${tag.name}> must not survive: ${tag.raw}`).toBe(true)
      // 2. No live tag carries a handler or a scheme, whatever the delimiter.
      expect(tag.raw, `no event handler on <${tag.name}>`).not.toMatch(/[/\s]on[a-z]+\s*=/)
      expect(tag.raw, `no formaction on <${tag.name}>`).not.toContain('formaction')
      expect(tag.raw, `no javascript: on <${tag.name}>`).not.toContain('javascript:')
      expect(tag.raw, `no vbscript: on <${tag.name}>`).not.toContain('vbscript:')
      expect(tag.raw, `no data: URL on <${tag.name}>`).not.toContain('data:text/html')
    }

    // 3. Script contents never survive as text either.
    expect(lower, 'no script element').not.toContain('<script')
  })

  it('keeps the formatting the editor is allowed to author', () => {
    const out = sanitizeRichHtml('<h2>Week 1</h2><p><strong>Sit</strong> then <em>stay</em></p><ul><li>ten reps</li></ul>')
    expect(out).toContain('<h2>')
    expect(out).toContain('<strong>')
    expect(out).toContain('<li>')
  })

  it('keeps real links but forces them safe', () => {
    const out = sanitizeRichHtml('<p><a href="https://pupmanager.com">site</a></p>')
    expect(out).toContain('href="https://pupmanager.com"')
    expect(out).toContain('rel="noopener noreferrer nofollow"')
    expect(out).toContain('target="_blank"')
  })

  it('escapes a legacy plain-text description rather than parsing it', () => {
    const out = sanitizeRichHtml('careful: 5 < 10 & <img src=x onerror=alert(1)>')
    expect(out).toContain('&lt;')
    expect(out.toLowerCase()).not.toContain('<img')
  })

  it('richTextToPlain strips every tag, including a script body', () => {
    expect(richTextToPlain('<p>hi</p><script>alert(1)</script>')).not.toContain('alert(1)')
    expect(richTextToPlain('<p>hi</p><img src=x onerror=alert(1)>').toLowerCase()).not.toContain('onerror')
  })

  it('isRichTextEmpty treats a script-only value as empty (its body is dropped)', () => {
    expect(isRichTextEmpty('<p></p>')).toBe(true)
    // sanitize-html drops <script> AND its contents, so nothing visible remains —
    // "empty" is the correct and safe answer, and the block is never rendered.
    expect(isRichTextEmpty('<script>alert(1)</script>')).toBe(true)
    expect(isRichTextEmpty('<p>real words</p>')).toBe(false)
  })
})
