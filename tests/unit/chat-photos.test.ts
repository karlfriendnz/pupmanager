import { describe, it, expect } from 'vitest'
import { messagePreview, PHOTO_ONLY_PREVIEW } from '@/lib/message-preview'
import {
  sniffImageType,
  pathBelongsToScope,
  buildAttachmentPath,
  attachmentCreateRows,
  toChatAttachments,
  attachmentRefSchema,
  MAX_ATTACHMENT_BYTES,
} from '@/lib/message-attachments'

// The pure half of "photos in chat". Everything here decides something a route
// or a screen then acts on, so each block names the bug it stops.

describe('messagePreview — the blank-line bug, everywhere at once', () => {
  it('a text message is just its text', () => {
    expect(messagePreview({ body: 'Bailey did great today' })).toBe('Bailey did great today')
  })

  it('collapses newlines so a preview never shows a blank line', () => {
    expect(messagePreview({ body: 'Hi\n\nQuestion about Friday' })).toBe('Hi Question about Friday')
  })

  it('clips to the lock-screen length', () => {
    const out = messagePreview({ body: 'x'.repeat(500) })
    // Same 117 + ellipsis the notify helpers used before this was shared.
    expect(out.length).toBe(118)
    expect(out.length).toBeLessThanOrEqual(120)
    expect(out.endsWith('…')).toBe(true)
  })

  it('a PHOTO-ONLY message says "📷 Photo" rather than nothing', () => {
    // This is the one people notice: a push notification with an empty body.
    expect(messagePreview({ body: '', attachmentCount: 1 })).toBe(PHOTO_ONLY_PREVIEW)
    expect(messagePreview({ body: '   ', attachmentCount: 1 })).toBe(PHOTO_ONLY_PREVIEW)
    expect(messagePreview({ body: null, attachmentCount: 1 })).toBe(PHOTO_ONLY_PREVIEW)
  })

  it('counts them when there is more than one', () => {
    expect(messagePreview({ body: '', attachmentCount: 3 })).toBe('📷 3 photos')
  })

  it('a message with BOTH leads with the words and marks the photo', () => {
    expect(messagePreview({ body: 'Is this right?', attachmentCount: 1 })).toBe('📷 Is this right?')
  })

  it('a legacy row with neither returns empty rather than throwing', () => {
    expect(messagePreview({ body: '', attachmentCount: 0 })).toBe('')
    expect(messagePreview({ body: undefined })).toBe('')
  })
})

describe('sniffImageType — the browser check is not the check', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00])
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
  const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00])
  const webp = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  ])

  it('reads the four formats a bubble can render', () => {
    expect(sniffImageType(jpeg)).toBe('image/jpeg')
    expect(sniffImageType(png)).toBe('image/png')
    expect(sniffImageType(gif)).toBe('image/gif')
    expect(sniffImageType(webp)).toBe('image/webp')
  })

  it('refuses an HTML document however it is labelled', () => {
    // "<!DOCTYPE h" — a stored-XSS attempt named photo.jpg.
    const html = new TextEncoder().encode('<!DOCTYPE html><script>alert(1)</script>')
    expect(sniffImageType(html)).toBeNull()
  })

  it('refuses an SVG — it is markup, not a bitmap', () => {
    expect(sniffImageType(new TextEncoder().encode('<svg xmlns="..."></svg>'))).toBeNull()
  })

  it('refuses HEIC, which half the recipients could not render', () => {
    // ftypheic box — uploads happily, then shows broken on Chrome/Android.
    const heic = new Uint8Array([
      0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63,
    ])
    expect(sniffImageType(heic)).toBeNull()
  })

  it('refuses an empty or truncated file', () => {
    expect(sniffImageType(new Uint8Array([]))).toBeNull()
    expect(sniffImageType(new Uint8Array([0xff, 0xd8]))).toBeNull()
  })
})

describe('pathBelongsToScope — a photo cannot cross threads', () => {
  it('accepts a path built for this thread', () => {
    const p = buildAttachmentPath({ kind: 'direct', clientId: 'cl_1' }, 'image/jpeg')
    expect(pathBelongsToScope(p, { kind: 'direct', clientId: 'cl_1' })).toBe(true)
  })

  it('refuses ANOTHER client thread', () => {
    const p = buildAttachmentPath({ kind: 'direct', clientId: 'cl_1' }, 'image/jpeg')
    expect(pathBelongsToScope(p, { kind: 'direct', clientId: 'cl_2' })).toBe(false)
  })

  it('refuses a group path posted into a direct thread and vice versa', () => {
    const g = buildAttachmentPath({ kind: 'group', groupId: 'g1' }, 'image/png')
    expect(pathBelongsToScope(g, { kind: 'direct', clientId: 'g1' })).toBe(false)
    const d = buildAttachmentPath({ kind: 'direct', clientId: 'cl_1' }, 'image/png')
    expect(pathBelongsToScope(d, { kind: 'group', groupId: 'cl_1' })).toBe(false)
  })

  it('refuses anything that climbs out of its own folder', () => {
    expect(pathBelongsToScope('chat/direct/cl_1/../cl_2/x.jpg', { kind: 'direct', clientId: 'cl_1' })).toBe(false)
    expect(pathBelongsToScope('chat/direct/cl_1/sub/x.jpg', { kind: 'direct', clientId: 'cl_1' })).toBe(false)
    expect(pathBelongsToScope('chat/direct/cl_1/', { kind: 'direct', clientId: 'cl_1' })).toBe(false)
  })

  it('a prefix that merely STARTS the same is not the same thread', () => {
    // "cl_1" must not match a thread whose id is "cl_10".
    const p = buildAttachmentPath({ kind: 'direct', clientId: 'cl_10' }, 'image/jpeg')
    expect(pathBelongsToScope(p, { kind: 'direct', clientId: 'cl_1' })).toBe(false)
  })

  it('carries a random component so two uploads never collide', () => {
    const a = buildAttachmentPath({ kind: 'direct', clientId: 'cl_1' }, 'image/jpeg')
    const b = buildAttachmentPath({ kind: 'direct', clientId: 'cl_1' }, 'image/jpeg')
    expect(a).not.toBe(b)
    // 36-char uuid + extension, not a caller-chosen filename.
    expect(a).toMatch(/^chat\/direct\/cl_1\/[0-9a-f-]{36}\.jpg$/)
  })
})

describe('attachmentCreateRows — order kept, foreign paths rejected', () => {
  const scope = { kind: 'direct' as const, clientId: 'cl_1' }
  const ref = (path: string) => ({ path, contentType: 'image/jpeg' as const, sizeBytes: 100 })

  it('numbers them in the order they were picked', () => {
    const out = attachmentCreateRows(
      [ref('chat/direct/cl_1/a.jpg'), ref('chat/direct/cl_1/b.jpg')],
      scope,
    )
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.rows.map(r => r.position)).toEqual([0, 1])
    expect(out.rows.map(r => r.storagePath)).toEqual(['chat/direct/cl_1/a.jpg', 'chat/direct/cl_1/b.jpg'])
  })

  it('fails the whole message when ANY path is foreign — never silently drops one', () => {
    // Quietly sending 1 photo when the sender picked 2 is worse than an error.
    const out = attachmentCreateRows(
      [ref('chat/direct/cl_1/a.jpg'), ref('chat/direct/cl_OTHER/b.jpg')],
      scope,
    )
    expect(out.ok).toBe(false)
  })

  it('no attachments is fine — every existing message reads back unchanged', () => {
    expect(attachmentCreateRows(undefined, scope)).toEqual({ ok: true, rows: [] })
    expect(attachmentCreateRows([], scope)).toEqual({ ok: true, rows: [] })
  })
})

describe('attachmentRefSchema — the wire contract refuses nonsense', () => {
  it('refuses a content type we never sniffed', () => {
    const r = attachmentRefSchema.safeParse({
      path: 'chat/direct/cl_1/a.svg', contentType: 'image/svg+xml', sizeBytes: 10,
    })
    expect(r.success).toBe(false)
  })

  it('refuses a size over the cap, whatever the browser claimed', () => {
    const r = attachmentRefSchema.safeParse({
      path: 'chat/direct/cl_1/a.jpg', contentType: 'image/jpeg', sizeBytes: MAX_ATTACHMENT_BYTES + 1,
    })
    expect(r.success).toBe(false)
  })

  it('refuses an absurd dimension hint', () => {
    const r = attachmentRefSchema.safeParse({
      path: 'chat/direct/cl_1/a.jpg', contentType: 'image/jpeg', sizeBytes: 10, width: 9_999_999, height: 1,
    })
    expect(r.success).toBe(false)
  })
})

describe('toChatAttachments — the storage path never reaches the browser', () => {
  it('sends an id-based url and nothing else', () => {
    const out = toChatAttachments([
      { id: 'a2', width: 800, height: 600, position: 1 },
      { id: 'a1', width: null, height: null, position: 0 },
    ])
    // Sorted by position, not by the order the DB happened to return.
    expect(out.map(a => a.id)).toEqual(['a1', 'a2'])
    expect(out[1].url).toBe('/api/message-images/a2')
    // AGENTS.md #5: a prop on a 'use client' component is page source.
    expect(JSON.stringify(out)).not.toContain('chat/')
    expect(JSON.stringify(out)).not.toContain('storagePath')
  })

  it('an old message with no photos is an empty list, not a crash', () => {
    expect(toChatAttachments(undefined)).toEqual([])
    expect(toChatAttachments(null)).toEqual([])
    expect(toChatAttachments([])).toEqual([])
  })
})
