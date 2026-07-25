import { sanitizeRichHtml, isRichTextEmpty } from '@/lib/rich-text'
import { cn } from '@/lib/utils'

// The one safe way to DISPLAY a rich-text description anywhere in the app.
// Sanitizes the stored HTML (see src/lib/rich-text.ts) and renders it with the
// shared .tiptap-body styling so headings/lists/links look right. Legacy
// plain-text descriptions render unchanged. Never dangerouslySetInnerHTML a
// description by hand — use this so the sanitize step can't be forgotten.
//
// Server-safe (sanitize-html runs on the server); usable in RSC and client
// components alike.
export function RichText({
  html,
  className,
  theme = 'light',
}: {
  html: string | null | undefined
  className?: string
  // 'light' (default) suits client/public/trainer surfaces; 'dark' for the
  // handful of dark panels (e.g. admin).
  theme?: 'light' | 'dark'
}) {
  if (isRichTextEmpty(html)) return null
  return (
    <div
      className={cn('tiptap-body', theme === 'light' && 'tiptap-light', className)}
      dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(html) }}
    />
  )
}
