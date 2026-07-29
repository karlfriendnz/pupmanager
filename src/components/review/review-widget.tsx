'use client'

/**
 * The in-app review widget — pin a comment on the real screen, then hand the
 * approved ones to an agent.
 *
 * Ported from fm-events, where it is how Karl directs work: he walks the app,
 * pins notes on the controls he means, ticks the ones he wants built, and clicks
 * Send. The capture (lib/review-core, shared with fm-events) is what makes a
 * two-word note actionable later; this component is the surface over it.
 *
 * Dev-only — mounted behind reviewToolsEnabled().
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePathname, useSearchParams } from 'next/navigation'
import {
  MessageSquarePlus, X, MapPin, Check, Trash2, Send, Loader2, Bot,
  ImagePlus, CornerDownRight, Eye, EyeOff, HelpCircle,
} from 'lucide-react'
import {
  describeElement, describePoint, describeTargetLine, pageKeyFor,
  resolveTargetElement, type ReviewTarget,
} from '@/lib/review-core'
// Side-effect import: registers this app's markup conventions with the capture.
import '@/lib/review-config'

interface Attachment { path: string; name?: string | null }

interface Comment {
  id: string
  pageKey: string
  seq: number | null
  body: string
  authorName: string | null
  x: number | null
  y: number | null
  context: ReviewTarget | null
  attachments: Attachment[] | null
  ready: boolean
  queuedAt: string | null
  claudeStatus: string | null
  claudeNote: string | null
  resolved: boolean
  parentId: string | null
  createdAt: string
}

/** Above every app overlay. The mobile header uses backdrop-blur, and modals sit
 *  at z-50 — a pin has to clear all of it or it hides behind the thing it's about. */
const Z = 2147483000

export function ReviewWidget({ authorName }: { authorName: string | null }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const href = useMemo(
    () => `${pathname}${searchParams.toString() ? `?${searchParams}` : ''}`,
    [pathname, searchParams],
  )
  const pageKey = useMemo(() => pageKeyFor(href), [href])

  // Portals need a real document. A 'use client' component is still rendered on
  // the SERVER first, where document doesn't exist — so nothing portals until
  // after mount.
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  const [open, setOpen] = useState(false)
  const [pinning, setPinning] = useState(false)
  const [pinsVisible, setPinsVisible] = useState(true)
  const [comments, setComments] = useState<Comment[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The pin being written, before it exists server-side.
  const [draft, setDraft] = useState<{ x: number; y: number; context: ReviewTarget | null } | null>(null)
  const [draftBody, setDraftBody] = useState('')
  const [draftFiles, setDraftFiles] = useState<Attachment[]>([])
  const [saving, setSaving] = useState(false)

  const [hoverBox, setHoverBox] = useState<{ rect: DOMRect; label: string } | null>(null)
  const [replyTo, setReplyTo] = useState<string | null>(null)
  const [replyBody, setReplyBody] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState<string | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)

  // Positions are recomputed from the DOM, so a pin rides scrolling, resizing and
  // anything reflowing above it. Kept in state (not style-on-render) because the
  // pins live in a portal that has no idea the page moved.
  const [tick, setTick] = useState(0)
  const rafRef = useRef<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/review/comments?pageKey=${encodeURIComponent(pageKey)}`)
      if (!res.ok) throw new Error()
      const data = await res.json() as { comments: Comment[] }
      setComments(data.comments)
    } catch {
      setError('Could not load the notes on this page.')
    } finally {
      setLoading(false)
    }
  }, [pageKey])

  useEffect(() => { void load() }, [load])

  // Keep pins glued to their elements. One rAF-throttled listener rather than a
  // permanent loop: idle cost matters on a page that's also being used.
  useEffect(() => {
    const bump = () => {
      if (rafRef.current != null) return
      rafRef.current = requestAnimationFrame(() => { rafRef.current = null; setTick(t => t + 1) })
    }
    window.addEventListener('scroll', bump, { passive: true, capture: true })
    window.addEventListener('resize', bump)
    return () => {
      window.removeEventListener('scroll', bump, { capture: true })
      window.removeEventListener('resize', bump)
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  // ── pin mode ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!pinning) { setHoverBox(null); return }

    const onMove = (e: MouseEvent) => {
      const el = elementUnder(e.clientX, e.clientY)
      if (!el) { setHoverBox(null); return }
      const t = describeElement(el, e)
      setHoverBox({ rect: el.getBoundingClientRect(), label: t ? describeTargetLine(t) : el.tagName.toLowerCase() })
    }
    const onClick = (e: MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const el = elementUnder(e.clientX, e.clientY)
      const context = el ? describeElement(el, e) : describePoint(e.clientX, e.clientY)
      // PAGE coords, not viewport: the fallback position has to survive a scroll.
      setDraft({ x: e.clientX + window.scrollX, y: e.clientY + window.scrollY, context })
      setPinning(false)
      setOpen(true)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPinning(false) }

    window.addEventListener('mousemove', onMove, true)
    window.addEventListener('click', onClick, true)
    window.addEventListener('keydown', onKey)
    document.body.style.cursor = 'crosshair'
    return () => {
      window.removeEventListener('mousemove', onMove, true)
      window.removeEventListener('click', onClick, true)
      window.removeEventListener('keydown', onKey)
      document.body.style.cursor = ''
    }
  }, [pinning])

  // ── screenshots ───────────────────────────────────────────────────────────
  const upload = useCallback(async (files: FileList | File[]) => {
    const added: Attachment[] = []
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/review/upload', { method: 'POST', body: fd })
      if (!res.ok) {
        const b = await res.json().catch(() => null) as { error?: string } | null
        setError(b?.error ?? 'That image would not upload.')
        continue
      }
      const a = await res.json() as Attachment & { url: string }
      added.push({ path: a.path, name: a.name })
    }
    if (added.length) setDraftFiles(prev => [...prev, ...added])
  }, [])

  // Paste straight from the clipboard — how a screenshot actually arrives.
  useEffect(() => {
    if (!draft) return
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? [])
      if (files.length) { e.preventDefault(); void upload(files) }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [draft, upload])

  // ── writes ────────────────────────────────────────────────────────────────
  async function saveDraft() {
    if (!draft || !draftBody.trim()) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/review/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pageKey,
          body: draftBody,
          authorName,
          x: draft.x,
          y: draft.y,
          context: draft.context,
          attachments: draftFiles,
          // His own notes are work by definition — the triage gate never costs
          // him a second click.
          ready: true,
        }),
      })
      if (!res.ok) throw new Error()
      setDraft(null); setDraftBody(''); setDraftFiles([])
      await load()
    } catch {
      setError('Could not save that note.')
    } finally {
      setSaving(false)
    }
  }

  async function patch(id: string, data: Record<string, unknown>) {
    setError(null)
    const res = await fetch(`/api/review/comments/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!res.ok) setError('That change did not save.')
    await load()
  }

  async function remove(id: string) {
    await fetch(`/api/review/comments/${id}`, { method: 'DELETE' })
    await load()
  }

  async function saveReply(parentId: string) {
    if (!replyBody.trim()) return
    await fetch('/api/review/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageKey, body: replyBody, authorName, parentId, ready: true }),
    })
    setReplyBody(''); setReplyTo(null)
    await load()
  }

  async function send() {
    setSending(true)
    setError(null)
    setSent(null)
    try {
      const res = await fetch('/api/review/brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json().catch(() => null) as { taskCount?: number; error?: string } | null
      if (!res.ok) { setError(data?.error ?? 'Could not write the brief.'); return }
      setSent(`${data?.taskCount ?? 0} sent — tell Claude "do the review tasks".`)
      await load()
    } catch {
      setError('Could not write the brief.')
    } finally {
      setSending(false)
    }
  }

  // ── derived ───────────────────────────────────────────────────────────────
  const roots = comments.filter(c => !c.parentId)
  const repliesOf = (id: string) => comments.filter(c => c.parentId === id)

  /** Viewport position for a pin: its element if we can still find it, else the
   *  page coords it was dropped at. void tick keeps this recomputing on scroll. */
  const pinPos = (c: Comment): { left: number; top: number } | null => {
    void tick
    const el = resolveTargetElement(c.context)
    if (el) {
      const r = el.getBoundingClientRect()
      const ox = c.context?.offsetX ?? 0.5
      const oy = c.context?.offsetY ?? 0.5
      return { left: r.left + r.width * ox, top: r.top + r.height * oy }
    }
    if (c.x == null || c.y == null) return null
    return { left: c.x - window.scrollX, top: c.y - window.scrollY }
  }

  const draftPos = draft
    ? { left: draft.x - window.scrollX, top: draft.y - window.scrollY }
    : null

  if (!mounted) return null

  return (
    <>
      {createPortal(
        <>
          {/* What you're about to attach to — outlined and NAMED, so choosing a
              target is something you can see rather than guess. */}
          {pinning && hoverBox && (
            <div
              data-review-overlay
              className="fixed pointer-events-none rounded ring-2 ring-amber-400 bg-amber-300/10"
              style={{
                left: hoverBox.rect.left, top: hoverBox.rect.top,
                width: hoverBox.rect.width, height: hoverBox.rect.height, zIndex: Z - 1,
              }}
            >
              <span className="absolute -top-6 left-0 max-w-[80vw] truncate rounded bg-slate-900 px-1.5 py-0.5 text-[11px] text-amber-200">
                {hoverBox.label}
              </span>
            </div>
          )}

          {/* The pin being written, so you can see WHERE it will land. */}
          {draftPos && (
            <div
              data-review-overlay
              className="fixed pointer-events-none -translate-x-1/2 -translate-y-1/2"
              style={{ left: draftPos.left, top: draftPos.top, zIndex: Z }}
            >
              <span className="absolute inset-0 -m-1 animate-ping rounded-full bg-amber-400/50" />
              <span className="relative grid h-7 w-7 place-items-center rounded-full bg-amber-400 ring-2 ring-white shadow-md">
                <MapPin className="h-3.5 w-3.5 text-slate-900" strokeWidth={2} />
              </span>
            </div>
          )}

          {/* The pins. Ring carries STATE so "what's already built" reads off the
              page without opening the panel. */}
          {pinsVisible && roots.map(c => {
            const pos = pinPos(c)
            if (!pos) return null
            const done = c.claudeStatus === 'done'
            const asking = c.claudeStatus === 'needs_info'
            return (
              <button
                key={c.id}
                data-review-overlay
                onClick={() => { setOpen(true); setFocusId(c.id) }}
                title={c.body}
                className={`fixed grid h-7 w-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full text-[11px] font-bold shadow-md transition-transform hover:scale-125 ${
                  done ? 'bg-emerald-500 text-white ring-[3px] ring-emerald-200'
                    : asking ? 'bg-amber-400 text-slate-900 ring-[3px] ring-amber-200'
                    : c.queuedAt ? 'bg-sky-500 text-white ring-2 ring-white'
                    : 'bg-rose-500 text-white ring-2 ring-white'
                } ${focusId === c.id ? 'scale-125 ring-slate-900' : ''}`}
                style={{ left: pos.left, top: pos.top, zIndex: Z }}
              >
                {c.seq ?? '•'}
              </button>
            )
          })}
        </>,
        document.body,
      )}

      {/* Launcher — bottom LEFT, because the app's own "+" owns bottom right. */}
      {createPortal(
        <div className="fixed bottom-4 left-4 flex items-center gap-2" style={{ zIndex: Z }}>
          <button
            onClick={() => setOpen(o => !o)}
            className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-3.5 py-2.5 text-sm font-semibold text-white shadow-lg hover:bg-slate-700"
            title="Review notes"
          >
            <MessageSquarePlus className="h-4 w-4" strokeWidth={1.75} />
            Review
            {roots.length > 0 && (
              <span className="rounded-full bg-rose-500 px-1.5 text-xs tabular-nums">{roots.length}</span>
            )}
          </button>
        </div>,
        document.body,
      )}

      {open && createPortal(
        <aside
          className="fixed right-0 top-0 flex h-full w-full max-w-[26rem] flex-col border-l border-slate-200 bg-white shadow-2xl"
          style={{ zIndex: Z }}
        >
          <header className="flex items-center gap-2 border-b border-slate-200 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-slate-900">Review notes</div>
              <div className="truncate font-mono text-[11px] text-slate-500">{pageKey}</div>
            </div>
            <button
              onClick={() => setPinsVisible(v => !v)}
              title={pinsVisible ? 'Hide pins' : 'Show pins'}
              className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
            >
              {pinsVisible ? <Eye className="h-4 w-4" strokeWidth={1.75} /> : <EyeOff className="h-4 w-4" strokeWidth={1.75} />}
            </button>
            <button onClick={() => setOpen(false)} title="Close" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100">
              <X className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </header>

          <div className="flex gap-2 border-b border-slate-200 px-3 py-2">
            <button
              onClick={() => { setPinning(true); setOpen(false) }}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700"
            >
              <MapPin className="h-4 w-4" strokeWidth={1.75} /> Pin a note
            </button>
            <button
              onClick={() => setDraft({ x: 0, y: 0, context: null })}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              title="A note about the whole screen, not one control"
            >
              Whole page
            </button>
          </div>

          {error && <p className="border-b border-rose-100 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
          {sent && <p className="border-b border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{sent}</p>}

          {/* Composer */}
          {draft && (
            <div
              className="border-b border-slate-200 bg-slate-50 p-3"
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); void upload(e.dataTransfer.files) }}
            >
              {draft.context ? (
                <p className="mb-1.5 truncate font-mono text-[11px] text-slate-500" title={describeTargetLine(draft.context)}>
                  {describeTargetLine(draft.context)}
                </p>
              ) : (
                <p className="mb-1.5 text-[11px] text-slate-500">A note about the whole screen.</p>
              )}
              <textarea
                autoFocus
                value={draftBody}
                onChange={e => setDraftBody(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void saveDraft() }}
                rows={3}
                placeholder="What's wrong with it?"
                className="w-full resize-y rounded-lg border border-slate-200 px-2.5 py-2 text-sm"
              />
              {draftFiles.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {draftFiles.map(f => (
                    <li key={f.path} className="overflow-hidden rounded border border-slate-200">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/${f.path.replace(/^public\//, '')}`} alt={f.name ?? 'screenshot'} className="h-14 w-20 object-cover" />
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-2 flex items-center gap-2">
                <button
                  onClick={saveDraft}
                  disabled={saving || !draftBody.trim()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
                >
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />} Save
                </button>
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-white">
                  <ImagePlus className="h-3.5 w-3.5" strokeWidth={1.75} /> Image
                  <input
                    type="file" accept="image/*" multiple className="hidden"
                    onChange={e => { if (e.target.files) void upload(e.target.files) }}
                  />
                </label>
                <button
                  onClick={() => { setDraft(null); setDraftBody(''); setDraftFiles([]) }}
                  className="text-xs text-slate-500 hover:text-slate-800"
                >
                  Cancel
                </button>
                <span className="ml-auto text-[11px] text-slate-400">or paste a shot</span>
              </div>
            </div>
          )}

          {/* The list. Its own scrollbar stays hidden — the page behind it has one. */}
          <div className="min-h-0 flex-1 overflow-y-auto no-scrollbar">
            {loading && roots.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-slate-500">Loading…</p>
            ) : roots.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-slate-500">
                Nothing pinned on this screen yet.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {roots.map(c => {
                  const done = c.claudeStatus === 'done'
                  const asking = c.claudeStatus === 'needs_info'
                  return (
                    <li
                      key={c.id}
                      className={`p-3 ${focusId === c.id ? 'bg-teal-50/50' : ''}`}
                      onMouseEnter={() => setFocusId(c.id)}
                    >
                      <div className="flex items-start gap-2">
                        <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white ${
                          done ? 'bg-emerald-500' : asking ? 'bg-amber-400 text-slate-900' : c.queuedAt ? 'bg-sky-500' : 'bg-rose-500'
                        }`}>
                          {c.seq ?? '•'}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="whitespace-pre-wrap text-sm text-slate-900">{c.body}</p>
                          {c.context && (
                            <p className="mt-1 truncate font-mono text-[11px] text-slate-500" title={describeTargetLine(c.context)}>
                              {describeTargetLine(c.context)}
                            </p>
                          )}
                          {c.attachments?.length ? (
                            <ul className="mt-1.5 flex flex-wrap gap-1.5">
                              {c.attachments.map(f => (
                                <li key={f.path} className="overflow-hidden rounded border border-slate-200">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={`/${f.path.replace(/^public\//, '')}`} alt={f.name ?? 'screenshot'} className="h-14 w-20 object-cover" />
                                </li>
                              ))}
                            </ul>
                          ) : null}

                          {/* What the agent did with it. Never resolves the note —
                              Karl signs off himself. */}
                          {(done || asking) && (
                            <p className={`mt-1.5 inline-flex items-start gap-1.5 rounded-md px-2 py-1 text-[11px] ${
                              done ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'
                            }`}>
                              {done ? <Bot className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} /> : <HelpCircle className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />}
                              <span>{c.claudeNote || (done ? 'Built.' : 'Needs more detail.')}</span>
                            </p>
                          )}
                          {!done && !asking && c.queuedAt && (
                            <p className="mt-1.5 text-[11px] text-sky-700">Sent — not started yet.</p>
                          )}

                          {repliesOf(c.id).map(r => (
                            <p key={r.id} className="mt-1.5 flex gap-1.5 border-l-2 border-slate-200 pl-2 text-xs text-slate-600">
                              <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-slate-400" strokeWidth={1.75} />
                              {r.body}
                            </p>
                          ))}

                          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                            <label className="inline-flex cursor-pointer items-center gap-1 text-slate-600">
                              <input
                                type="checkbox"
                                checked={c.ready}
                                onChange={e => void patch(c.id, { ready: e.target.checked })}
                                className="h-3.5 w-3.5 rounded border-slate-300"
                              />
                              Build this
                            </label>
                            <button onClick={() => setReplyTo(replyTo === c.id ? null : c.id)} className="text-slate-500 hover:text-slate-900">
                              Reply
                            </button>
                            <button
                              onClick={() => void patch(c.id, { resolved: true })}
                              className="inline-flex items-center gap-1 text-emerald-700 hover:text-emerald-900"
                            >
                              <Check className="h-3.5 w-3.5" strokeWidth={1.75} /> Sign off
                            </button>
                            <button
                              onClick={() => void remove(c.id)}
                              className="ml-auto inline-flex items-center gap-1 text-slate-400 hover:text-rose-600"
                              title="Delete"
                            >
                              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                            </button>
                          </div>

                          {replyTo === c.id && (
                            <div className="mt-2 flex gap-1.5">
                              <input
                                autoFocus
                                value={replyBody}
                                onChange={e => setReplyBody(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') void saveReply(c.id) }}
                                placeholder="Add a detail…"
                                className="h-8 flex-1 rounded-lg border border-slate-200 px-2 text-xs"
                              />
                              <button onClick={() => void saveReply(c.id)} className="rounded-lg bg-slate-900 px-2.5 text-xs font-semibold text-white">
                                Add
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <footer className="border-t border-slate-200 p-3">
            <button
              onClick={send}
              disabled={sending}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} /> : <Send className="h-4 w-4" strokeWidth={1.75} />}
              Send ticked notes to Claude
            </button>
            <p className="mt-1.5 text-center text-[11px] text-slate-500">
              Everything ticked “Build this”, on every screen — not just this one.
            </p>
          </footer>
        </aside>,
        document.body,
      )}
    </>
  )
}

/**
 * The element under the cursor, ignoring the widget's own chrome. Without this
 * every pin would attach to the highlight box drawn on top of the thing being
 * pointed at.
 */
function elementUnder(clientX: number, clientY: number): Element | null {
  const stack = document.elementsFromPoint(clientX, clientY)
  return stack.find(el => !el.closest('[data-review-overlay]') && !el.closest('aside[style*="2147483000"]')) ?? null
}
