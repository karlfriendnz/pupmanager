import { escapeHtml } from '@/lib/enquiries'

// Turns an email body into email-client-ready HTML, used by BOTH the admin
// preview and the actual send renderer so they always match.
//
// Bodies are now authored as HTML (TipTap). Legacy bodies are plain text with
// blank-line paragraphs — we detect those and convert. Either way we inline
// styles on the block/inline tags TipTap produces, because email clients
// largely ignore <style> blocks and class names.
export function emailBodyToHtml(raw: string): string {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return ''
  // An empty editor doc (e.g. "<p></p>") has no real text — treat as empty.
  if (!trimmed.replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' ').trim()) return ''

  const looksHtml = /<\/?(p|h[1-6]|ul|ol|li|strong|b|em|i|a|br|div|blockquote)\b/i.test(trimmed)
  let html = looksHtml
    ? trimmed
    : trimmed
        .split(/\n{2,}/)
        .map(p => `<p>${escapeHtml(p).split('\n').join('<br/>')}</p>`)
        .join('')

  html = html
    .replace(/<p>/g, '<p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#0f172a;">')
    .replace(/<h1>/g, '<h1 style="margin:18px 0 10px;font-size:22px;font-weight:700;line-height:1.25;color:#0f172a;">')
    .replace(/<h2>/g, '<h2 style="margin:18px 0 8px;font-size:18px;font-weight:700;line-height:1.3;color:#0f172a;">')
    .replace(/<h3>/g, '<h3 style="margin:16px 0 6px;font-size:15px;font-weight:700;line-height:1.3;color:#0f172a;">')
    .replace(/<ul>/g, '<ul style="margin:0 0 14px;padding-left:22px;list-style:disc outside;font-size:14px;line-height:1.6;color:#0f172a;">')
    .replace(/<ol>/g, '<ol style="margin:0 0 14px;padding-left:22px;list-style:decimal outside;font-size:14px;line-height:1.6;color:#0f172a;">')
    .replace(/<li>/g, '<li style="margin:0 0 4px;">')
    .replace(/<blockquote>/g, '<blockquote style="margin:0 0 14px;padding-left:14px;border-left:3px solid #e2e8f0;color:#475569;">')
    .replace(/<a /g, '<a style="color:#2a9da9;text-decoration:underline;" ')

  return html
}

// Plain-text fallback for the email's text/plain part — strips tags from HTML
// bodies and decodes the few entities our authoring produces.
export function emailHtmlToText(raw: string): string {
  return (raw ?? '')
    .replace(/<\/(p|h[1-6]|li|ul|ol|div|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
