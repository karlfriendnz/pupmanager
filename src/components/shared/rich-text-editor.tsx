'use client'

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
export function RichTextEditor({ value, onChange, minHeight = 260 }: { value: string; onChange: (html: string) => void; minHeight?: number }) {
  const editor = useEditor({
    immediatelyRender: false, // required under Next SSR to avoid hydration mismatch
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] } }),
      Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer' } }),
    ],
    content: emailBodyToHtml(value),
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: {
        class: 'tiptap-body rounded-b-xl bg-slate-900 border border-t-0 border-slate-700 px-3 py-3 text-sm text-slate-100 leading-relaxed focus:outline-none',
        style: `min-height:${minHeight}px`,
      },
    },
  })

  if (!editor) return <div className="min-h-[300px] rounded-xl bg-slate-900 border border-slate-700" />

  return (
    <div>
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  )
}

function Toolbar({ editor }: { editor: Editor }) {
  const Btn = ({ on, active, label, children }: { on: () => void; active?: boolean; label: string; children: React.ReactNode }) => (
    <button
      type="button"
      onMouseDown={e => { e.preventDefault(); on() }}
      aria-label={label}
      className={`h-8 w-8 grid place-items-center rounded-md transition-colors ${active ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-700'}`}
    >
      {children}
    </button>
  )

  const setLink = () => {
    const prev = editor.getAttributes('link').href as string | undefined
    const url = window.prompt('Link URL', prev ?? 'https://')
    if (url === null) return
    if (url === '') { editor.chain().focus().extendMarkRange('link').unsetLink().run(); return }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }

  return (
    <div className="flex items-center gap-1 rounded-t-xl bg-slate-800 border border-slate-700 px-2 py-1.5">
      <Btn label="Heading" active={editor.isActive('heading', { level: 2 })} on={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 className="h-4 w-4" /></Btn>
      <Btn label="Subheading" active={editor.isActive('heading', { level: 3 })} on={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}><Heading3 className="h-4 w-4" /></Btn>
      <span className="mx-1 h-5 w-px bg-slate-700" />
      <Btn label="Bold" active={editor.isActive('bold')} on={() => editor.chain().focus().toggleBold().run()}><Bold className="h-4 w-4" /></Btn>
      <Btn label="Italic" active={editor.isActive('italic')} on={() => editor.chain().focus().toggleItalic().run()}><Italic className="h-4 w-4" /></Btn>
      <span className="mx-1 h-5 w-px bg-slate-700" />
      <Btn label="Bulleted list" active={editor.isActive('bulletList')} on={() => editor.chain().focus().toggleBulletList().run()}><List className="h-4 w-4" /></Btn>
      <Btn label="Numbered list" active={editor.isActive('orderedList')} on={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered className="h-4 w-4" /></Btn>
      <span className="mx-1 h-5 w-px bg-slate-700" />
      <Btn label="Add link" active={editor.isActive('link')} on={setLink}><LinkIcon className="h-4 w-4" /></Btn>
      {editor.isActive('link') && <Btn label="Remove link" on={() => editor.chain().focus().unsetLink().run()}><Unlink className="h-4 w-4" /></Btn>}
    </div>
  )
}
