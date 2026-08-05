'use client'

import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * The one shape every form editor wears.
 *
 * A trainer edits four different things on the Forms screen — the intake form,
 * session forms, lead-capture forms and the website enquiry forms embedded off
 * them — and each had grown its own screen. This is the shape the lead-capture
 * editor settled on, extracted so the others can wear it too:
 *
 *   [status strip]   publish state, plus whatever else this form can do
 *   [one block]      hairline-divided sections, never a stack of cards
 *   [footer]         Delete on the left, Cancel + Save on the right
 *
 * See AGENTS.md "Mobile-first look" — flat surfaces, hairline dividers, no
 * decorative colour.
 */

/** Shared control classes so every editor's inputs measure the same. */
export const FORM_INPUT =
  'h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[var(--pm-brand-500)]'
export const FORM_TEXTAREA =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[var(--pm-brand-500)]'
/** A quiet text action — the "Preview", "Embed code", "Add question" kind. */
export const FORM_QUIET_ACTION =
  'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50'

/** Label + optional hint above one control. */
export function FormField({
  label,
  hint,
  required,
  children,
}: {
  label: string
  hint?: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-slate-700">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>
      {hint && <p className="-mt-0.5 text-xs text-slate-400">{hint}</p>}
      {children}
    </div>
  )
}

/** One hairline-separated section of the editor block. */
export function FormEditorSection({
  title,
  hint,
  action,
  children,
}: {
  title?: string
  hint?: React.ReactNode
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-3 px-4 py-4 sm:px-5 sm:py-5">
      {/* The header stacks on a phone — a hint squeezed into a third of the
          width beside two buttons reads as one word per line. */}
      {(title || action) && (
        <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
          <div className="min-w-0">
            {title && (
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</h2>
            )}
            {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
          </div>
          {action && (
            <div className="-ml-2.5 flex flex-wrap items-center gap-1 sm:ml-0 sm:flex-shrink-0 sm:gap-2">
              {action}
            </div>
          )}
        </div>
      )}
      {children}
    </section>
  )
}

/**
 * A switch row — the flat replacement for the tinted "enabled" cards each
 * editor used to grow. `trailing` takes a second, separate control (a field's
 * Required/Optional flip) so it never ends up nested inside the switch.
 */
export function FormToggleRow({
  label,
  hint,
  checked,
  onChange,
  trailing,
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (v: boolean) => void
  trailing?: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-3 py-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className={`block text-sm font-medium ${checked ? 'text-slate-900' : 'text-slate-500'}`}>
            {label}
          </span>
          {hint && <span className="mt-0.5 block text-xs text-slate-400">{hint}</span>}
        </span>
        <span
          className={`h-5 w-9 flex-shrink-0 rounded-full p-0.5 transition-colors ${
            checked ? 'bg-[var(--pm-brand-600)]' : 'bg-slate-200'
          }`}
          aria-hidden
        >
          <span className={`block h-4 w-4 rounded-full bg-white transition-transform ${checked ? 'translate-x-4' : ''}`} />
        </span>
      </button>
      {trailing}
    </div>
  )
}

/**
 * A small set of choices, as underlined tabs.
 *
 * Not a pill track — Karl has rejected those repeatedly, and a tinted rounded
 * track is the tell of a machine-made screen (AGENTS.md).
 */
export function FormSegmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { id: T; label: string }[]
  value: T
  onChange: (v: T) => void
  ariaLabel?: string
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4" role="group" aria-label={ariaLabel}>
      {options.map(o => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          aria-pressed={value === o.id}
          className={`-mb-px border-b-2 px-0.5 pb-2 pt-1 text-sm font-medium transition-colors ${
            value === o.id
              ? 'border-slate-900 text-slate-900'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Rows inside a section, split by hairlines rather than gaps. */
export function FormRowGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col [&>*+*]:border-t [&>*+*]:border-slate-100">{children}</div>
  )
}

export interface FormEditorStatus {
  isActive: boolean
  busy?: boolean
  onToggle: () => void
}

/**
 * The editor frame: status strip, the block of sections, and the footer.
 * Delete keeps its own inline confirm so no editor has to re-invent it.
 */
export function FormEditorShell({
  status,
  statusActions,
  error,
  children,
  sidebar,
  holdSidebarColumn = true,
  onDelete,
  onCancel,
  extraActions,
  onSave,
  saving,
  saveLabel,
}: {
  /** Publish/draft toggle — omitted for a form that doesn't exist yet. */
  status?: FormEditorStatus
  /** Extra buttons on the status strip (preview, embed code…). */
  statusActions?: React.ReactNode
  error?: string | null
  children: React.ReactNode
  /**
   * The field palette, on the left of the form (see `_form-builder.tsx`).
   *
   * DESKTOP ONLY, on purpose. A 240px rail beside a form does not fit a 390px
   * phone, and AGENTS.md makes mobile the primary layout — so below `lg` this
   * is not rendered at all and the builder puts the very same palette in a
   * FullScreenSheet instead. One column, tap to add.
   */
  sidebar?: React.ReactNode
  /**
   * Keep the palette column open when there is no palette in it (the default).
   *
   * That is right for TABS, where pressing Settings must not slide the panel
   * sideways. It is wrong for the wizard: its steps have no palette, so the
   * held-open column left the panel hard right of a lap of empty page and the
   * whole thing read as broken rather than centred. Moving between numbered
   * steps is a deliberate journey — a palette appearing beside the questions is
   * expected there, in a way a tab flick never is.
   */
  holdSidebarColumn?: boolean
  /** Omitted for a new form — there's nothing to delete yet. */
  onDelete?: () => Promise<void> | void
  onCancel: () => void
  /** Anything that belongs beside Cancel and Save — e.g. Preview. */
  extraActions?: React.ReactNode
  onSave: () => Promise<void> | void
  saving?: boolean
  saveLabel: string
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  return (
    <div className="flex flex-col gap-4">
      {/* The grid is here on BOTH tabs, whether or not there is a rail to put
          in it. Dropping it when `sidebar` was undefined is what made switching
          to Settings feel broken: the panel fell into column one and stretched
          to the full page, so the tab you pressed moved everything sideways and
          left a subject line sitting in a 940px-wide field.

          A tab switch swaps what is IN a panel. It should never move the panel.
          So the first column is held open even when empty — the rail goes, and
          nothing else does. */}
      <div className={`grid gap-4 lg:items-start ${
        sidebar || holdSidebarColumn ? 'lg:grid-cols-[17rem_minmax(0,1fr)] xl:grid-cols-[20rem_minmax(0,1fr)]' : 'lg:grid-cols-1'
      }`}>
        {sidebar ? (
          // Sticky so the palette is still there when you have scrolled to
          // question twelve. `no-scrollbar` because a visible rail here would be
          // the second scrollbar on screen, which Karl has banned outright.
          <aside className="no-scrollbar hidden lg:sticky lg:top-4 lg:block lg:max-h-[calc(100vh-5rem)] lg:overflow-y-auto">
            {sidebar}
          </aside>
        ) : holdSidebarColumn ? (
          // Holds the column open. Below lg the grid is one column anyway, so
          // this contributes nothing on a phone — no stray gap, no empty row.
          <div className="hidden lg:block" aria-hidden="true" />
        ) : null}

        <div className="flex min-w-0 flex-col rounded-xl border border-slate-200 bg-white [&>section+section]:border-t [&>section+section]:border-slate-200">
          <div className="sticky top-0 z-20 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-t-xl border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:flex-nowrap sm:px-5">
            {/* Status and its actions live IN the bar, not in a card above it
                (Karl, 2026-08-06: "1 line?"). Two stacked strips of chrome — one
                saying Published, one holding Save — cost about 120px of the
                screen before a single question, and neither was the form. */}
            {(status || statusActions) && (
              <div className="mr-auto flex flex-wrap items-center gap-1">
          {status && (
            <button
              type="button"
              onClick={status.onToggle}
              disabled={status.busy}
              className={FORM_QUIET_ACTION}
              aria-label={status.isActive ? 'Unpublish this form' : 'Publish this form'}
            >
              <span
                className={`h-2 w-2 rounded-full ${status.isActive ? 'bg-emerald-500' : 'bg-amber-400'}`}
                aria-hidden
              />
              {status.isActive ? 'Published' : 'Draft'}
            </button>
          )}
          {statusActions}
              </div>
            )}
            {onDelete && (
              confirmDelete ? (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      setDeleting(true)
                      try { await onDelete() } finally { setDeleting(false) }
                    }}
                    disabled={deleting}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                    {deleting ? 'Deleting…' : 'Confirm delete'}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-medium text-red-500 hover:bg-red-50"
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Delete
                </button>
              )
            )}
            {extraActions}
            <Button
              variant="ghost"
              size="sm"
              onClick={onCancel}
              className={`shrink-0 whitespace-nowrap ${onDelete ? '' : 'ml-auto'}`}
            >
              Cancel
            </Button>
            <Button size="sm" loading={saving} onClick={onSave} className="shrink-0 whitespace-nowrap">
              {saveLabel}
            </Button>
          </div>

          {error && (
            <p
              role="alert"
              className="border-b border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600 sm:px-5"
            >
              {error}
            </p>
          )}

          {children}

        </div>
      </div>
    </div>
  )
}
