'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { Search, HelpCircle, Settings, LogOut, ChevronDown, Flame } from 'lucide-react'
import { cn } from '@/lib/utils'
import { signOutWithPush } from '@/lib/sign-out'
import { OrgSwitcher } from './org-switcher'

type Org = { id: string; name: string; role: string }
type Scope = 'all' | 'client' | 'breed' | 'dog'

const SCOPES: { value: Scope; label: string }[] = [
  { value: 'all', label: 'Anything' },
  { value: 'client', label: 'Client' },
  { value: 'breed', label: 'Breed' },
  { value: 'dog', label: 'Dog' },
]

// Top-right control cluster for the trainer shell: the engagement streak, a
// slide-out client search (with a scope selector), a Help shortcut, and the
// account menu (org switcher + Settings + Sign out). Lives in the shell so it
// shows on every page. Desktop only — mobile uses the bottom-bar "More" sheet.
export function TopBarControls({
  userName,
  userEmail,
  orgs = [],
  activeCompanyId = null,
  streak = null,
}: {
  userName?: string | null
  userEmail?: string | null
  orgs?: Org[]
  activeCompanyId?: string | null
  streak?: { current: number } | null
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<Scope>('all')
  const menuRef = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLFormElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // Close menus when the route changes — adjust state during render.
  const [lastPath, setLastPath] = useState(pathname)
  if (pathname !== lastPath) { setLastPath(pathname); setMenuOpen(false); setSearchOpen(false) }

  // Outside-click / Escape closes the account menu and the (empty) search.
  useEffect(() => {
    if (!menuOpen && !searchOpen) return
    function onPointer(ev: MouseEvent | TouchEvent) {
      const t = ev.target as Node
      if (menuRef.current && !menuRef.current.contains(t)) setMenuOpen(false)
      if (searchRef.current && !searchRef.current.contains(t) && !query.trim()) setSearchOpen(false)
    }
    function onKey(ev: KeyboardEvent) { if (ev.key === 'Escape') { setMenuOpen(false); setSearchOpen(false) } }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onPointer); document.removeEventListener('keydown', onKey) }
  }, [menuOpen, searchOpen, query])

  // Focus the input as it slides open.
  useEffect(() => { if (searchOpen) inputRef.current?.focus() }, [searchOpen])

  function submitSearch(e: React.FormEvent) {
    e.preventDefault()
    const q = query.trim()
    if (!q) { setSearchOpen(false); return }
    const params = new URLSearchParams({ q })
    if (scope !== 'all') params.set('scope', scope)
    router.push(`/clients?${params.toString()}`)
  }

  const initial = userName?.[0]?.toUpperCase() ?? '?'

  return (
    // A real sticky bar (not a floating overlay) so page headers/toolbars stack
    // BELOW it instead of being covered. Reserves h-14 at the top of <main>;
    // PageHeader sticks just beneath it via the --app-top-offset var.
    <header className="hidden md:flex sticky top-0 z-30 h-14 items-center justify-end gap-1 px-4 lg:px-6 border-b border-slate-100 bg-white/85 backdrop-blur">
      {/* Streak — a plain ghost circle until there's a streak, then an orange
          pill with the count. Matches the search/help circles when idle. */}
      {streak && (
        <Link
          href="/awards"
          title={streak.current > 0 ? `${streak.current}-training-day streak` : 'Start a streak — finish notes on a training day'}
          className={cn(
            'flex items-center justify-center h-9 rounded-full text-sm font-semibold transition-colors',
            streak.current > 0
              ? 'gap-1 px-3 bg-orange-500 text-white shadow-sm hover:bg-orange-600'
              : 'w-9 text-slate-500 hover:text-slate-900 hover:bg-slate-100',
          )}
        >
          <Flame className="h-[18px] w-[18px]" />
          {streak.current > 0 && <span>{streak.current}</span>}
        </Link>
      )}

      {/* Slide-out search with a scope selector. Borderless ghost circle when
          collapsed; grows into a bordered field when open. */}
      <form
        ref={searchRef}
        onSubmit={submitSearch}
        className={cn(
          'flex items-center rounded-full transition-[width,background-color] duration-200 overflow-hidden',
          searchOpen ? 'w-[19rem] lg:w-[22rem] border border-slate-200 bg-white shadow-sm' : 'w-9',
        )}
      >
        <button
          type="button"
          onClick={() => setSearchOpen(o => !o)}
          aria-label="Search"
          className={cn(
            'h-9 w-9 shrink-0 grid place-items-center rounded-full text-slate-500 transition-colors',
            !searchOpen && 'hover:text-slate-900 hover:bg-slate-100',
          )}
        >
          <Search className="h-[18px] w-[18px]" />
        </button>
        {searchOpen && (
          <>
            <select
              value={scope}
              onChange={e => setScope(e.target.value as Scope)}
              aria-label="Search scope"
              className="h-9 shrink-0 bg-transparent text-xs font-medium text-slate-500 border-l border-slate-200 pl-2 pr-1 focus:outline-none cursor-pointer"
            >
              {SCOPES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={scope === 'breed' ? 'Search by breed…' : scope === 'dog' ? 'Search by dog…' : 'Search clients…'}
              aria-label="Search clients"
              className="flex-1 min-w-0 h-9 bg-transparent px-2 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none"
            />
          </>
        )}
      </form>

      {/* Divider keeps the account control visually distinct from the actions. */}
      <span className="mx-1.5 h-5 w-px bg-slate-200" aria-hidden />

      {/* Profile / account */}
      <div ref={menuRef} className="relative">
        <button
          type="button"
          onClick={() => setMenuOpen(v => !v)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className="flex items-center gap-1.5 rounded-full pl-0.5 pr-1.5 h-9 hover:bg-slate-100 transition-colors"
        >
          <span className="h-8 w-8 grid place-items-center rounded-full bg-gradient-to-br from-blue-500 via-indigo-500 to-violet-500 text-white text-sm font-semibold shadow-sm">{initial}</span>
          <ChevronDown className={cn('h-3.5 w-3.5 text-slate-400 transition-transform', menuOpen && 'rotate-180')} />
        </button>

        {menuOpen && (
          <div role="menu" className="absolute right-0 mt-2 w-64 rounded-2xl bg-white shadow-[0_18px_45px_-12px_rgba(15,23,42,0.25)] border border-slate-100 overflow-hidden">
            <div className="px-4 py-3 bg-gradient-to-br from-slate-50 to-white border-b border-slate-100">
              <p className="text-sm font-semibold text-slate-900 truncate">{userName ?? 'You'}</p>
              {userEmail && <p className="text-xs text-slate-500 truncate">{userEmail}</p>}
            </div>

            {orgs.length > 1 && (
              <div className="px-3 py-2 border-b border-slate-100">
                <p className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Workspace</p>
                <OrgSwitcher orgs={orgs} activeId={activeCompanyId} />
              </div>
            )}

            <Link href="/settings" role="menuitem" className={cn('flex items-center gap-2 w-full px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 transition-colors')}>
              <Settings className="h-4 w-4 text-slate-400" /> Settings
            </Link>
            <button
              type="button"
              onClick={() => signOutWithPush()}
              role="menuitem"
              className="flex items-center gap-2 w-full px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <LogOut className="h-4 w-4 text-slate-400" /> Sign out
            </button>
          </div>
        )}
      </div>

      {/* Help — kept as the far-right icon. */}
      <Link
        href="/help"
        title="Help"
        aria-label="Help"
        className="h-9 w-9 grid place-items-center rounded-full text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
      >
        <HelpCircle className="h-[18px] w-[18px]" />
      </Link>
    </header>
  )
}
