'use client'

import { useEffect } from 'react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import { Bold, Italic, Heading2, Heading3, List, ListOrdered, Link as LinkIcon, Unlink } from 'lucide-react'
import { emailBodyToHtml } from '@/lib/email-html'

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
    toolbar: 'flex items-center gap-1 rounded-t-xl bg-slate-800 border border-slate-700 px-2 py-1.5',
    skeleton: 'min-h-[300px] rounded-xl bg-slate-900 border border-slate-700',
  },
  light: {
    body: 'tiptap-body tiptap-light rounded-b-xl bg-white border border-t-0 border-slate-200 px-3 py-3 text-sm text-slate-900 leading-relaxed focus:outline-none',
    toolbar: 'flex items-center gap-1 rounded-t-xl bg-slate-50 border border-slate-200 px-2 py-1.5',
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

  const cls = { activeCls, idleCls }
  return (
    <div className={THEME[theme].toolbar}>
      <ToolbarBtn {...cls} label="Heading" active={editor.isActive('heading', { level: 2 })} on={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 className="h-4 w-4" /></ToolbarBtn>
      <ToolbarBtn {...cls} label="Subheading" active={editor.isActive('heading', { level: 3 })} on={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}><Heading3 className="h-4 w-4" /></ToolbarBtn>
      <span className={`mx-1 h-5 w-px ${divider}`} />
      <ToolbarBtn {...cls} label="Bold" active={editor.isActive('bold')} on={() => editor.chain().focus().toggleBold().run()}><Bold className="h-4 w-4" /></ToolbarBtn>
      <ToolbarBtn {...cls} label="Italic" active={editor.isActive('italic')} on={() => editor.chain().focus().toggleItalic().run()}><Italic className="h-4 w-4" /></ToolbarBtn>
      <span className={`mx-1 h-5 w-px ${divider}`} />
      <ToolbarBtn {...cls} label="Bulleted list" active={editor.isActive('bulletList')} on={() => editor.chain().focus().toggleBulletList().run()}><List className="h-4 w-4" /></ToolbarBtn>
      <ToolbarBtn {...cls} label="Numbered list" active={editor.isActive('orderedList')} on={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered className="h-4 w-4" /></ToolbarBtn>
      <span className={`mx-1 h-5 w-px ${divider}`} />
      <ToolbarBtn {...cls} label="Add link" active={editor.isActive('link')} on={setLink}><LinkIcon className="h-4 w-4" /></ToolbarBtn>
      {editor.isActive('link') && <ToolbarBtn {...cls} label="Remove link" on={() => editor.chain().focus().unsetLink().run()}><Unlink className="h-4 w-4" /></ToolbarBtn>}
    </div>
  )
}
