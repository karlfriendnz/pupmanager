'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { DOG_BREEDS } from '@/lib/dog-breeds'

interface BreedSelectProps {
  /** Current breed string (controlled). */
  value: string
  /** Called with the new breed string on type or select. */
  onChange: (value: string) => void
  label?: string
  placeholder?: string
  required?: boolean
  disabled?: boolean
  id?: string
  className?: string
  /** Override the breed list (defaults to the canonical DOG_BREEDS). */
  options?: string[]
}

/**
 * Accessible breed combobox: a text input with type-ahead filtering over the
 * canonical breed list. Keyboard nav (↑/↓/Enter/Esc), click-to-select, and
 * free-text fallback so unusual breeds are never blocked — the value is always
 * just the string the user has typed or picked.
 *
 * Controlled component (value/onChange), compatible with react-hook-form via
 * a Controller. Styling matches src/components/ui/input.tsx.
 */
export function BreedSelect({
  value,
  onChange,
  label,
  placeholder = 'Start typing a breed…',
  required,
  disabled,
  id,
  className,
  options = DOG_BREEDS,
}: BreedSelectProps) {
  const reactId = useId()
  const inputId = id ?? `breed-${reactId}`
  const listId = `${inputId}-listbox`

  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const matches = useMemo(() => {
    const q = value.trim().toLowerCase()
    if (!q) return options.slice(0, 50)
    // Prefix matches first, then substring matches.
    const starts: string[] = []
    const contains: string[] = []
    for (const b of options) {
      const lower = b.toLowerCase()
      if (lower.startsWith(q)) starts.push(b)
      else if (lower.includes(q)) contains.push(b)
    }
    return [...starts, ...contains].slice(0, 50)
  }, [value, options])

  // Reset highlight whenever the filtered set changes.
  useEffect(() => {
    setActive(0)
  }, [value])

  // Close on outside click.
  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  // Keep the highlighted option scrolled into view.
  useEffect(() => {
    if (!open || !listRef.current) return
    const el = listRef.current.children[active] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  function select(breed: string) {
    onChange(breed)
    setOpen(false)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) {
        setOpen(true)
        return
      }
      setActive(a => Math.min(a + 1, matches.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive(a => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      if (open && matches[active]) {
        e.preventDefault()
        select(matches[active])
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault()
        setOpen(false)
      }
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={inputId} className="text-sm font-medium text-slate-700">
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}
      <div ref={wrapRef} className="relative">
        <input
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && matches[active] ? `${inputId}-opt-${active}` : undefined}
          autoComplete="off"
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={e => {
            onChange(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className={cn(
            'h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-slate-50 disabled:text-slate-500',
            className
          )}
        />
        {open && matches.length > 0 && (
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
          >
            {matches.map((breed, i) => (
              <li
                key={breed}
                id={`${inputId}-opt-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={e => {
                  // mousedown (not click) so it fires before the input blur.
                  e.preventDefault()
                  select(breed)
                }}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  'cursor-pointer px-4 py-2 text-sm text-slate-700',
                  i === active && 'bg-blue-50 text-blue-700'
                )}
              >
                {breed}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
