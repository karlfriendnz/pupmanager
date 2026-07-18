'use client'

import { useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { ImagePlus, Trash2, Loader2, Plus, ArrowUp, ArrowDown, Type } from 'lucide-react'
import { RichTextEditor } from '@/components/shared/rich-text-editor'
import { htmlHasText } from '@/lib/email-html'
import { compressImageFile } from '@/lib/compress-image'

// A composed email body is an ordered list of stacked blocks (text/image),
// mirroring the admin onboarding-emails builder. Shared by the trainer bulk
// composer and the admin announcements composer so there's ONE block builder.
export type EmailBlock =
  | { id: string; type: 'text'; html: string }
  | { id: string; type: 'image'; url: string; link?: string }

// Escape a value destined for an HTML attribute (URLs/links in serialized img).
function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Flatten ordered blocks into one HTML body. Image blocks are wrapped in a
// block-level <div> — the email sanitizer only keeps inline styles on block-level
// tags, and a bare <img> would be escaped. Empty image blocks are dropped.
export function serializeBlocks(blocks: EmailBlock[]): string {
  return blocks
    .map(b => {
      if (b.type === 'text') return b.html
      if (!b.url) return ''
      const img = `<img src="${escapeAttr(b.url)}" style="display:block;max-width:100%;height:auto;border-radius:12px;margin:0 auto;border:0;" />`
      const inner = b.link ? `<a href="${escapeAttr(b.link)}">${img}</a>` : img
      return `<div style="margin:16px 0;text-align:center;">${inner}</div>`
    })
    .filter(Boolean)
    .join('\n')
}

// Valid when at least one block has content: a text block with visible text, or
// an image block with an uploaded url.
export function blocksHaveContent(blocks: EmailBlock[]): boolean {
  return blocks.some(b => (b.type === 'text' ? htmlHasText(b.html) : !!b.url))
}

// A fresh seed block for a brand-new email body.
export function seedBlocks(): EmailBlock[] {
  return [{ id: 'b0', type: 'text', html: '' }]
}

// Next unused block id, derived from the current set so it never collides with
// whatever the parent seeded (b0, b1, …).
function nextBlockId(blocks: EmailBlock[]): string {
  const max = blocks.reduce((m, b) => {
    const n = /^b(\d+)$/.exec(b.id)
    return n ? Math.max(m, Number(n[1])) : m
  }, -1)
  return `b${max + 1}`
}

// The stacked text/image block editor (add/remove/reorder, rich text, image
// upload). Controlled: the parent owns `blocks` (so it can serialize for a
// preview/send). Placeholders + subject stay with the parent, which uses
// `onEditorReady`/`onBlockFocus` to insert tokens into the focused text block.
export function EmailBodyBuilder({
  blocks,
  onBlocksChange,
  disabled = false,
  onEditorReady,
  onBlockFocus,
}: {
  blocks: EmailBlock[]
  onBlocksChange: (blocks: EmailBlock[]) => void
  disabled?: boolean
  onEditorReady?: (id: string, editor: Editor) => void
  onBlockFocus?: (id: string) => void
}) {
  const [uploadingId, setUploadingId] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const pendingUploadRef = useRef<string | null>(null)

  function addText() { onBlocksChange([...blocks, { id: nextBlockId(blocks), type: 'text', html: '' }]) }
  function addImage() { onBlocksChange([...blocks, { id: nextBlockId(blocks), type: 'image', url: '', link: '' }]) }
  function removeBlock(id: string) { onBlocksChange(blocks.filter(b => b.id !== id)) }
  function moveBlock(id: string, dir: 'up' | 'down') {
    const i = blocks.findIndex(b => b.id === id)
    const j = dir === 'up' ? i - 1 : i + 1
    if (i < 0 || j < 0 || j >= blocks.length) return
    const next = [...blocks]
    ;[next[i], next[j]] = [next[j], next[i]]
    onBlocksChange(next)
  }
  function updateText(id: string, html: string) {
    onBlocksChange(blocks.map(b => (b.id === id && b.type === 'text' ? { ...b, html } : b)))
  }
  function updateImage(id: string, patch: { url?: string; link?: string }) {
    onBlocksChange(blocks.map(b => (b.id === id && b.type === 'image' ? { ...b, ...patch } : b)))
  }
  function pickImage(id: string) { pendingUploadRef.current = id; fileRef.current?.click() }

  async function uploadBlockImage(id: string, file: File) {
    setUploadError(null)
    setUploadingId(id)
    try {
      const toSend = await compressImageFile(file)
      const fd = new FormData()
      fd.append('file', toSend)
      fd.append('sessionId', 'email')
      const res = await fetch('/api/upload/image', { method: 'POST', body: fd })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.url) updateImage(id, { url: data.url as string })
      else setUploadError(typeof data?.error === 'string' ? data.error : 'Could not upload image.')
    } catch {
      setUploadError('Could not upload image — please try again.')
    } finally {
      setUploadingId(null)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {blocks.map((block, i) => (
        <div key={block.id} className="rounded-xl border border-slate-200 p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              {block.type === 'text' ? <Type className="h-3.5 w-3.5" /> : <ImagePlus className="h-3.5 w-3.5" />}
              {block.type === 'text' ? 'Text' : 'Image'}
            </span>
            <div className="flex items-center gap-0.5">
              <button type="button" onClick={() => moveBlock(block.id, 'up')} disabled={disabled || i === 0}
                className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30 disabled:hover:text-slate-400" aria-label="Move block up">
                <ArrowUp className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => moveBlock(block.id, 'down')} disabled={disabled || i === blocks.length - 1}
                className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30 disabled:hover:text-slate-400" aria-label="Move block down">
                <ArrowDown className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => removeBlock(block.id)} disabled={disabled || blocks.length === 1}
                className="p-1 text-slate-400 hover:text-rose-600 disabled:opacity-30 disabled:hover:text-slate-400" aria-label="Delete block">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>

          {block.type === 'text' ? (
            <div onFocus={() => onBlockFocus?.(block.id)}>
              <RichTextEditor
                key={block.id}
                theme="light"
                value={block.html}
                onChange={html => updateText(block.id, html)}
                minHeight={140}
                onEditorReady={ed => onEditorReady?.(block.id, ed)}
              />
            </div>
          ) : block.url ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-start gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={block.url} alt="" className="h-20 w-32 rounded-lg object-cover border border-slate-200 flex-shrink-0" />
                <div className="flex items-center gap-3 pt-1">
                  <button type="button" onClick={() => pickImage(block.id)} disabled={uploadingId === block.id}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--pm-brand-700)] hover:underline disabled:opacity-60">
                    {uploadingId === block.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
                    Change
                  </button>
                  <button type="button" onClick={() => updateImage(block.id, { url: '' })}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-600 hover:text-rose-700">
                    <Trash2 className="h-3.5 w-3.5" /> Remove
                  </button>
                </div>
              </div>
              <input
                value={block.link ?? ''}
                onChange={e => updateImage(block.id, { link: e.target.value })}
                placeholder="Link when clicked (optional) — https://…"
                className="w-full h-9 rounded-lg border border-slate-200 px-3 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--pm-brand-500)]"
              />
            </div>
          ) : (
            <button type="button" onClick={() => pickImage(block.id)} disabled={uploadingId === block.id}
              className="inline-flex items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs font-medium text-slate-600 hover:border-[var(--pm-brand-500)] hover:text-[var(--pm-brand-700)] disabled:opacity-60">
              {uploadingId === block.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
              {uploadingId === block.id ? 'Uploading…' : 'Upload image'}
            </button>
          )}
        </div>
      ))}

      {/* Shared hidden input feeds whichever image block requested it. */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => {
          const f = e.target.files?.[0]
          const id = pendingUploadRef.current
          if (f && id) uploadBlockImage(id, f)
        }}
      />

      {uploadError && <p className="text-xs text-rose-600">{uploadError}</p>}

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={addText} disabled={disabled}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:border-[var(--pm-brand-500)] hover:text-[var(--pm-brand-700)] disabled:opacity-40">
          <Plus className="h-3.5 w-3.5" /> Add text
        </button>
        <button type="button" onClick={addImage} disabled={disabled}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:border-[var(--pm-brand-500)] hover:text-[var(--pm-brand-700)] disabled:opacity-40">
          <Plus className="h-3.5 w-3.5" /> Add image
        </button>
      </div>
    </div>
  )
}
