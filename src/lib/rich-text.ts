import sanitizeHtml from 'sanitize-html'

// The shared rich-text contract for the whole app. RichTextEditor
// (src/components/shared/rich-text-editor.tsx) authors a constrained subset of
// HTML — headings h2/h3, bold/italic, bullet/ordered lists, and links — which
// every "description" field now stores. Because ANY trainer can author this and
// it renders to clients and the public, the display path is an XSS boundary:
// sanitize with a strict allowlist (sanitize-html, not the admin-only regex pass
// in email-html.ts) before it ever reaches dangerouslySetInnerHTML.

// Tags the editor can produce, plus the inline formatting they nest. Anything
// else (script/style/img/iframe/on* handlers/etc.) is dropped.
const ALLOWED_TAGS = ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'h2', 'h3', 'ul', 'ol', 'li', 'a', 'blockquote', 'code', 'pre', 'span']

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,
  // The editor's TextStyle+Color mark emits <span style="color:…">. Allow the
  // style attribute but restrict it to `color` with a strict value allowlist
  // (allowedStyles below), so no other CSS can ride in.
  allowedAttributes: { a: ['href', 'target', 'rel'], span: ['style'] },
  allowedStyles: {
    '*': {
      color: [
        /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/,
        /^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/,
        /^rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*(?:0|1|0?\.\d+)\s*\)$/,
        /^[a-zA-Z]+$/,
      ],
    },
  },
  // http/https/mailto/tel only — no javascript:/data:/vbscript:.
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowProtocolRelative: false,
  // Force links safe regardless of what was authored.
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer nofollow' }),
  },
}

/**
 * Sanitize trainer/user-authored rich-text HTML for safe display anywhere
 * (client app, public pages, trainer views). Always run this before
 * dangerouslySetInnerHTML. Plain text passes through unchanged (it's valid HTML
 * text), so legacy plain-text descriptions keep rendering correctly.
 */
/**
 * True when the value carries no HTML at all — a legacy description typed into
 * a plain <textarea> before the rich editor existed.
 */
const HAS_MARKUP = /<\/?[a-z][a-z0-9]*(\s[^<>]*)?>/i

/**
 * Plain text -> minimal HTML, preserving the line breaks the author typed.
 * Escaped FIRST, so a description containing "<3" or "a < b" can never become
 * markup; blank lines become paragraphs and single newlines become <br>.
 */
function plainTextToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return escaped
    .split(/\n{2,}/)
    .map(block => `<p>${block.replace(/\n/g, '<br />')}</p>`)
    .join('')
}

export function sanitizeRichHtml(html: string | null | undefined): string {
  if (!html) return ''
  // A plain-text description rendered straight into innerHTML loses every line
  // break — HTML collapses whitespace — so a carefully laid out class blurb
  // arrives as one unreadable run-on block. These predate the rich editor and
  // are still all over the database, so they are converted rather than
  // "rendered unchanged" as this file used to claim.
  if (!HAS_MARKUP.test(html)) return plainTextToHtml(html)
  return sanitizeHtml(html, SANITIZE_OPTIONS)
}

/**
 * Strip a rich-text value down to plain text — for email plain-text parts,
 * previews, and any non-HTML context. Block tags become line breaks so the text
 * doesn't run together; list items get a leading dash.
 */
export function richTextToPlain(html: string | null | undefined): string {
  if (!html) return ''
  const withBreaks = html
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/(p|h2|h3|li|ul|ol|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
  return sanitizeHtml(withBreaks, { allowedTags: [], allowedAttributes: {} })
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * True when the rich-text value has no visible content — empty string, or the
 * editor's empty document (`<p></p>`) / whitespace only. Use to decide whether
 * to render a description block at all.
 */
export function isRichTextEmpty(html: string | null | undefined): boolean {
  if (!html) return true
  const stripped = sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, '')
  return stripped.length === 0
}
