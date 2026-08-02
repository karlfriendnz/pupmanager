'use client'

import { useEffect, useState } from 'react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import { TextStyle } from '@tiptap/extension-text-style'
import { Color } from '@tiptap/extension-color'
import { Bold, Italic, Heading2, Heading3, List, ListOrdered, Link as LinkIcon, Unlink, Baseline } from 'lucide-react'
import { emailBodyToHtml } from '@/lib/email-html'

// Preset text colours for the toolbar swatch. Deliberately small and on-brand —
// ink + muted slate, the two PupManager brand colours (teal, amber), then four
// utility brights. All are dark enough to stay readable on a white card, which
// a free-form colour input could not guarantee.
const TEXT_COLORS = ['#0f172a', '#64748b', '#2a9da9', '#f59e0b', '#ef4444', '#16a34a', '#0ea5e9', '#db2777']

// The trainer's own brand colour (TrainerProfile.emailAccentColor) is offered as
// an extra first swatch. Fetched once per page load and shared by every editor
// instance — on surfaces with no trainer session (admin onboarding emails) the
// request 401s and we simply show the presets.
let accentPromise: Promise<string | null> | null = null
function fetchTrainerAccent(): Promise<string | null> {
  accentPromise ??= fetch('/api/trainer/profile')
    .then(r => (r.ok ? r.json() : null))
    .then((p: unknown) => {
      const c = p && typeof p === 'object' ? (p as { emailAccentColor?: unknown }).emailAccentColor : null
      return typeof c === 'string' && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(c) ? c : null
    })
    .catch(() => null)
  return accentPromise
}

// Basic rich-text editor for email bodies — headings, bold/italic, lists, links.
// Emits HTML via onChange. `value` is the stored body (HTML, or legacy plain
// text which we convert on load). The PARENT must remount this per document
// (key={emailId}) so the initial content reflects the selected email — that's
// why there's no content-sync effect here.
//
// `theme` defaults to 'dark' (the original admin onboarding-emails surface).
// Trainer-facing surfaces on white cards pass theme="light".
type Theme = 'dark' | 'light'

const THEME: Record<Theme, { body: string; toolbar: string; skeleton: string }> = {
  dark: {
    body: 'tiptap-body rounded-b-xl bg-slate-900 border border-t-0 border-slate-700 px-3 py-3 text-sm text-slate-100 leading-relaxed focus:outline-none',
    toolbar: 'flex flex-wrap items-center gap-1 rounded-t-xl bg-slate-800 border border-slate-700 px-2 py-1.5',
    skeleton: 'min-h-[300px] rounded-xl bg-slate-900 border border-slate-700',
  },
  light: {
    body: 'tiptap-body tiptap-light rounded-b-xl bg-white border border-t-0 border-slate-200 px-3 py-3 text-sm text-slate-900 leading-relaxed focus:outline-none',
    toolbar: 'flex flex-wrap items-center gap-1 rounded-t-xl bg-slate-50 border border-slate-200 px-2 py-1.5',
    skeleton: 'min-h-[300px] rounded-xl bg-white border border-slate-200',
  },
}

export function RichTextEditor({ value, onChange, onBlur, minHeight = 260, theme = 'dark', disabled = false, onEditorReady }: { value: string; onChange: (html: string) => void; onBlur?: () => void; minHeight?: number; theme?: Theme; disabled?: boolean; onEditorReady?: (editor: Editor) => void }) {
  const t = THEME[theme]
  const editor = useEditor({
    immediatelyRender: false, // required under Next SSR to avoid hydration mismatch
    editable: !disabled,
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] } }),
      Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer' } }),
      TextStyle,
      Color,
    ],
    content: emailBodyToHtml(value),
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    onBlur: () => onBlur?.(),
    editorProps: {
      attributes: {
        class: t.body,
        style: `min-height:${minHeight}px`,
      },
    },
  })

  // Hand the editor instance up to the parent (e.g. for inserting
  // `{{placeholder}}` chips at the cursor). Optional — existing callers that
  // don't pass it are unaffected.
  useEffect(() => {
    if (editor && onEditorReady) onEditorReady(editor)
  }, [editor, onEditorReady])

  if (!editor) return <div className={t.skeleton} />

  return (
    <div className={disabled ? 'opacity-60 pointer-events-none' : undefined}>
      <Toolbar editor={editor} theme={theme} />
      <EditorContent editor={editor} />
    </div>
  )
}

// Toolbar button. Module-scoped (not defined inside Toolbar's render) so it
// keeps a stable identity across renders; theme classes come in as props.
function ToolbarBtn({ on, active, label, activeCls, idleCls, children }: { on: () => void; active?: boolean; label: string; activeCls: string; idleCls: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onMouseDown={e => { e.preventDefault(); on() }}
      aria-label={label}
      className={`h-8 w-8 grid place-items-center rounded-md transition-colors ${active ? activeCls : idleCls}`}
    >
      {children}
    </button>
  )
}

function Toolbar({ editor, theme }: { editor: Editor; theme: Theme }) {
  const activeCls = theme === 'dark' ? 'bg-blue-600 text-white' : 'bg-accent text-white'
  const idleCls = theme === 'dark' ? 'text-slate-300 hover:bg-slate-700' : 'text-slate-500 hover:bg-slate-200'
  const divider = theme === 'dark' ? 'bg-slate-700' : 'bg-slate-200'

  const setLink = () => {
    const prev = editor.getAttributes('link').href as string | undefined
    const url = window.prompt('Link URL', prev ?? 'https://')
    if (url === null) return
    if (url === '') { editor.chain().focus().extendMarkRange('link').unsetLink().run(); return }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }

  const [showColors, setShowColors] = useState(false)
  const currentColor = editor.getAttributes('textStyle').color as string | undefined

  // Trainer's brand colour first, then the presets (skipped if it's already one).
  const [brand, setBrand] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    fetchTrainerAccent().then(c => { if (!cancelled) setBrand(c) })
    return () => { cancelled = true }
  }, [])
  const swatches = brand && !TEXT_COLORS.includes(brand.toLowerCase()) ? [brand, ...TEXT_COLORS] : TEXT_COLORS

  const cls = { activeCls, idleCls }
  return (
    <div className={THEME[theme].toolbar}>
      <ToolbarBtn {...cls} label="Bold" active={editor.isActive('bold')} on={() => editor.chain().focus().toggleBold().run()}><Bold className="h-4 w-4" /></ToolbarBtn>
      <ToolbarBtn {...cls} label="Italic" active={editor.isActive('italic')} on={() => editor.chain().focus().toggleItalic().run()}><Italic className="h-4 w-4" /></ToolbarBtn>
      {/* Text colour — a swatch that opens a preset palette. Buttons (not a
          native colour input) so the text selection isn't lost on open. */}
      <span className="relative">
        <ToolbarBtn {...cls} label="Text colour" active={showColors || !!currentColor}
          on={() => setShowColors(v => !v)}>
          <Baseline className="h-4 w-4" style={currentColor ? { color: currentColor } : undefined} />
        </ToolbarBtn>
        {/* Palette is wide enough for four swatches a row: globals.css forces
            every <button> to a 44px minimum touch target, so each circle is
            44px wide however small its own classes are. */}
        {showColors && (
          <div className={`absolute z-20 top-9 left-0 flex flex-wrap gap-1.5 w-[214px] p-2 rounded-lg shadow-lg border ${theme === 'dark' ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
            {swatches.map(c => (
              <button key={c} type="button" aria-label={c === brand ? `Brand colour ${c}` : `Colour ${c}`}
                onMouseDown={e => { e.preventDefault(); editor.chain().focus().setColor(c).run(); setShowColors(false) }}
                className={`h-6 w-6 rounded-full border hover:scale-110 transition-transform ${c === brand ? 'border-2 border-slate-400' : 'border-black/10'}`}
                style={{ backgroundColor: c }} />
            ))}
            {/* Any colour at all, not just the nine.
                A native <input type="color"> IS the operating system's own
                picker — spectrum, eyedropper, hex box — so "full colour picker"
                costs no dependency and behaves the way the trainer's machine
                already behaves. The swatches stay because they are the fast
                path, and one of them is the trainer's own brand colour.

                onChange, not onMouseDown: the value arrives as the user drags
                around the wheel, so the text recolours live. Tiptap keeps the
                selection while the editor is blurred and `.focus()` restores
                it, so the colour lands on the words that were highlighted. */}
            <label
              className={`flex h-6 cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-xs ${theme === 'dark' ? 'text-slate-300 hover:bg-slate-700' : 'text-slate-500 hover:bg-slate-100'}`}
              title="Pick any colour"
            >
              <span
                aria-hidden
                className="h-4 w-4 flex-shrink-0 rounded-full border border-black/10"
                style={{
                  background: 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)',
                }}
              />
              Custom
              <input
                type="color"
                aria-label="Pick any text colour"
                value={currentColor ?? '#000000'}
                onChange={e => editor.chain().focus().setColor(e.target.value).run()}
                className="sr-only"
              />
            </label>
            <button type="button"
              onMouseDown={e => { e.preventDefault(); editor.chain().focus().unsetColor().run(); setShowColors(false) }}
              className={`h-6 px-2 rounded-md text-xs ${theme === 'dark' ? 'text-slate-300 hover:bg-slate-700' : 'text-slate-500 hover:bg-slate-100'}`}>
              Default
            </button>
          </div>
        )}
      </span>
      <span className={`mx-1 h-5 w-px ${divider}`} />
      <ToolbarBtn {...cls} label="Bulleted list" active={editor.isActive('bulletList')} on={() => editor.chain().focus().toggleBulletList().run()}><List className="h-4 w-4" /></ToolbarBtn>
      <ToolbarBtn {...cls} label="Numbered list" active={editor.isActive('orderedList')} on={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered className="h-4 w-4" /></ToolbarBtn>
      <span className={`mx-1 h-5 w-px ${divider}`} />
      <ToolbarBtn {...cls} label="Add link" active={editor.isActive('link')} on={setLink}><LinkIcon className="h-4 w-4" /></ToolbarBtn>
      {editor.isActive('link') && <ToolbarBtn {...cls} label="Remove link" on={() => editor.chain().focus().unsetLink().run()}><Unlink className="h-4 w-4" /></ToolbarBtn>}
      {/* Headings live at the END of the toolbar — the everyday controls
          (bold/italic/colour/lists/link) come first. */}
      <span className={`mx-1 h-5 w-px ${divider}`} />
      <ToolbarBtn {...cls} label="Heading" active={editor.isActive('heading', { level: 2 })} on={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 className="h-4 w-4" /></ToolbarBtn>
      <ToolbarBtn {...cls} label="Subheading" active={editor.isActive('heading', { level: 3 })} on={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}><Heading3 className="h-4 w-4" /></ToolbarBtn>
    </div>
  )
}
