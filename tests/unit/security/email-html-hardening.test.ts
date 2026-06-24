import { describe, it, expect } from 'vitest'
import { sanitizeEmailHtml, emailBodyToHtml } from '@/lib/email-html'

// Harder XSS / obfuscation cases for the authored-email sanitizer, layered on
// top of the baseline coverage in xss-sanitize.test.ts. These probe the regex
// passes against nested, mixed-case, scheme-obfuscated and SVG-vector payloads.
//
// NOTE: sanitizeEmailHtml is a regex-based scrubber (see the comment in
// email-html.ts). Two of the cases below document REAL bypasses that survive it
// — those tests are written to FAIL if the holes are ever closed, so they double
// as a regression tripwire. They are clearly flagged.

describe('sanitizeEmailHtml — element stripping holds for obfuscated payloads', () => {
  it('strips a mixed-case <SCRIPT> block', () => {
    const out = sanitizeEmailHtml('<SCRIPT>alert(1)</SCRIPT>')
    expect(out.toLowerCase()).not.toContain('<script')
    expect(out).not.toContain('alert(1)')
  })

  it('strips whitespace-padded < script > tags', () => {
    const out = sanitizeEmailHtml('<  script >alert(1)<  /  script >')
    expect(out.toLowerCase()).not.toContain('script')
    expect(out).not.toContain('alert(1)')
  })

  it('a fully-nested <scr<script>ipt> collapses to nothing dangerous', () => {
    const out = sanitizeEmailHtml('<scr<script>ipt>alert(1)</scr</script>ipt>')
    expect(out.toLowerCase()).not.toContain('<script')
    expect(out).not.toContain('alert(1)')
  })

  it('removes <style> exfiltration blocks entirely', () => {
    const out = sanitizeEmailHtml('<p>hi</p><style>body{background:url("http://evil/x")}</style>')
    expect(out.toLowerCase()).not.toContain('<style')
    expect(out).not.toContain('evil')
    expect(out).toContain('<p>hi</p>')
  })

  it('removes SVG and its nested vectors (<use>, <foreignObject>, <script>)', () => {
    expect(sanitizeEmailHtml('<svg><use href="#x"/></svg>').toLowerCase()).not.toContain('<svg')
    const fo = sanitizeEmailHtml('<svg><foreignObject><script>x()</script></foreignObject></svg>')
    expect(fo.toLowerCase()).not.toContain('<svg')
    expect(fo.toLowerCase()).not.toContain('<script')
    expect(fo).not.toContain('x()')
  })

  it('removes <math>, <iframe>, <object>, <embed>, <link>, <meta>, <base>', () => {
    for (const tag of ['math', 'iframe', 'object', 'embed', 'link', 'meta', 'base']) {
      const out = sanitizeEmailHtml(`<${tag} src="x">y</${tag}>`)
      expect(out.toLowerCase(), `${tag} should be stripped`).not.toContain(`<${tag}`)
    }
  })
})

describe('sanitizeEmailHtml — event handlers & URL schemes', () => {
  it('strips onmouseover and other event handlers (quoted, single-quoted, unquoted)', () => {
    expect(sanitizeEmailHtml('<p onmouseover="evil()">hi</p>').toLowerCase()).not.toContain('onmouseover')
    expect(sanitizeEmailHtml("<p onmouseover='evil()'>hi</p>").toLowerCase()).not.toContain('onmouseover')
    expect(sanitizeEmailHtml('<p onclick=evil()>hi</p>').toLowerCase()).not.toContain('onclick')
  })

  it('neutralises a quoted javascript: href', () => {
    const out = sanitizeEmailHtml('<a href="javascript:alert(1)">x</a>')
    expect(out).not.toContain('javascript:alert(1)')
  })

  it('neutralises a quoted data:text/html href', () => {
    const out = sanitizeEmailHtml('<a href="data:text/html,<b>x</b>">x</a>')
    expect(out).not.toContain('data:text/html')
  })

  it('neutralises a quoted vbscript: src', () => {
    const out = sanitizeEmailHtml('<img src="vbscript:msgbox(1)">')
    expect(out).not.toContain('vbscript:')
  })

  it('PRESERVES safe mailto: and https: links', () => {
    expect(sanitizeEmailHtml('<a href="mailto:a@b.com">mail</a>')).toContain('href="mailto:a@b.com"')
    expect(sanitizeEmailHtml('<a href="https://pupmanager.com">x</a>')).toContain('href="https://pupmanager.com"')
  })
})

// ── Regression tests for the two hardened bypasses (previously vulnerable) ────
// These payloads used to survive the regex sanitizer and reach the admin
// preview / live mail. The sanitizer now normalises char refs + whitespace
// before the scheme check, so the dangerous scheme must be neutralised.
describe('sanitizeEmailHtml — obfuscated URL-scheme bypasses are neutralised', () => {
  it('whitespace-obfuscated scheme (java\\tscript:) is neutralised', () => {
    const out = sanitizeEmailHtml('<a href="java\tscript:alert(1)">x</a>')
    expect(out).not.toContain('script:alert(1)')
    expect(out).toContain('href="#"')
  })

  it('entity-encoded scheme (java&#9;script:) is neutralised', () => {
    const out = sanitizeEmailHtml('<a href="java&#9;script:alert(1)">x</a>')
    expect(out).not.toContain('script:alert')
    expect(out).toContain('href="#"')
  })

  it('UNQUOTED javascript: href is neutralised', () => {
    const out = sanitizeEmailHtml('<a href=javascript:alert(1)>x</a>')
    expect(out).not.toContain('javascript:alert(1)')
  })
})

describe('emailBodyToHtml — end-to-end HTML branch sanitisation', () => {
  it('a <script> in an authored HTML body does not survive rendering', () => {
    const out = emailBodyToHtml('<p>Welcome</p><script>document.cookie</script>')
    expect(out).not.toContain('<script')
    expect(out).not.toContain('document.cookie')
    expect(out).toContain('Welcome')
  })

  it('plain-text bodies are escaped, never interpreted as HTML', () => {
    const out = emailBodyToHtml('hi <img src=x onerror=alert(1)> there')
    // Treated as plain text → angle brackets escaped, no live tag.
    expect(out).toContain('&lt;img')
    expect(out.toLowerCase()).not.toContain('<img')
  })

  it('event handlers on otherwise-allowed tags are stripped through the HTML branch', () => {
    const out = emailBodyToHtml('<p onmouseover="steal()">read me</p>')
    expect(out.toLowerCase()).not.toContain('onmouseover')
    expect(out).not.toContain('steal()')
    expect(out).toContain('read me')
  })

  it('an empty editor doc ("<p></p>") resolves to empty string', () => {
    expect(emailBodyToHtml('<p></p>')).toBe('')
    expect(emailBodyToHtml('   ')).toBe('')
  })
})
