'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { Search, HelpCircle, Settings, LogOut, ChevronDown, Flame, Bell, Plus, UserPlus, Receipt, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { signOutWithPush } from '@/lib/sign-out'
import { OrgSwitcher } from './org-switcher'
import { SaleComposer } from './sale-composer'

type Org = { id: string; name: string; role: string }
type Scope = 'all' | 'client' | 'breed' | 'dog'
type Suggestion = { id: string; name: string | null; dogName: string | null; dogBreed: string | null; dogPhotoUrl: string | null }

// Wait this long after the last keystroke before asking the server. Long enough
// that typing a name doesn't fire a request per letter, short enough to feel
// instant.
const SUGGEST_DEBOUNCE_MS = 180
// Below this, matches are too broad to be useful and just churn the list.
const MIN_QUERY = 2

// The engagement streak is hidden from the control bar for now. The prop and
// its server-side plumbing stay wired — flip this to bring it back.
const SHOW_STREAK: boolean = false

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
  notifCount = 0,
  canSell = false,
  currency = 'nzd',
}: {
  userName?: string | null
  userEmail?: string | null
  orgs?: Org[]
  activeCompanyId?: string | null
  streak?: { current: number } | null
  notifCount?: number
  /** Instant-sale add-on on AND the member may raise a sale — hides "New sale". */
  canSell?: boolean
  currency?: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [saleOpen, setSaleOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<Scope>('all')
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [highlighted, setHighlighted] = useState(-1)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const addRef = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // Close menus when the route changes — adjust state during render.
  const [lastPath, setLastPath] = useState(pathname)
  if (pathname !== lastPath) { setLastPath(pathname); setMenuOpen(false); setSearchOpen(false); setAddOpen(false) }

  // Declared above the effects that call it — a function declaration would
  // hoist, but the lint rule (rightly) flags reading it before its line, since
  // that hides staleness bugs when a closure captures an older version.
  const closeSearch = () => {
    setSearchOpen(false)
    setQuery('')
    setSuggestions([])
    setHighlighted(-1)
  }

  // Outside-click / Escape closes the account menu, the create menu and the
  // search. Search now closes on ANY outside click — it used to stay open while
  // it had text, which with a suggestion list hanging below would leave the
  // dropdown floating over whatever you clicked next.
  useEffect(() => {
    if (!menuOpen && !searchOpen && !addOpen) return
    function onPointer(ev: MouseEvent | TouchEvent) {
      const t = ev.target as Node
      if (menuRef.current && !menuRef.current.contains(t)) setMenuOpen(false)
      if (addRef.current && !addRef.current.contains(t)) setAddOpen(false)
      if (searchRef.current && !searchRef.current.contains(t)) closeSearch()
    }
    function onKey(ev: KeyboardEvent) {
      if (ev.key !== 'Escape') return
      setMenuOpen(false)
      setAddOpen(false)
      // Two-step: the first Escape steps out of the suggestion list (handled on
      // the input), a second closes the search. Without the `highlighted` check
      // one press would do both and throw away what they typed.
      if (searchOpen && highlighted < 0) closeSearch()
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onPointer); document.removeEventListener('keydown', onKey) }
    // closeSearch only touches setState — stable enough to leave out.
     
  }, [menuOpen, searchOpen, addOpen, highlighted])

  // Focus the input as it slides open.
  useEffect(() => { if (searchOpen) inputRef.current?.focus() }, [searchOpen])

  // Suggestions, debounced. The server does the scoping (a restricted staff
  // member only ever sees their own clients), so this can't leak anyone.
  //
  // The effect ONLY fetches — it never clears synchronously. Whether to show
  // what's in state is derived below instead, so a too-short query doesn't
  // cause a cascading render just to empty a list nobody's looking at.
  useEffect(() => {
    const q = query.trim()
    if (!searchOpen || q.length < MIN_QUERY) return

    let cancelled = false
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/clients?q=${encodeURIComponent(q)}&scope=${scope}`)
        const body = await res.json().catch(() => ({ items: [] }))
        if (cancelled) return
        setSuggestions(body.items ?? [])
        setHighlighted(-1)
      } catch {
        // A failed lookup just means no suggestions — Enter still runs the full
        // search, so the search box never becomes unusable.
        if (!cancelled) setSuggestions([])
      }
    }, SUGGEST_DEBOUNCE_MS)

    return () => { cancelled = true; clearTimeout(t) }
  }, [query, scope, searchOpen])

  // What's actually offered. Derived so the last query's matches can't linger
  // on screen after the box is cleared or closed, without an effect to police it.
  const showSuggestions = searchOpen && query.trim().length >= MIN_QUERY
  const visible = showSuggestions ? suggestions : []

  function goToClient(id: string) {
    closeSearch()
    router.push(`/clients/${id}`)
  }

  function runFullSearch() {
    const q = query.trim()
    if (!q) { closeSearch(); return }
    const params = new URLSearchParams({ q })
    if (scope !== 'all') params.set('scope', scope)
    router.push(`/clients?${params.toString()}`)
    setSearchOpen(false)
  }

  function submitSearch(e: React.FormEvent) {
    e.preventDefault()
    // Enter on a highlighted suggestion jumps straight to that client;
    // otherwise it falls through to the full results page.
    if (highlighted >= 0 && visible[highlighted]) { goToClient(visible[highlighted].id); return }
    runFullSearch()
  }

  // Arrow keys move through the list; Escape steps back out of it before
  // closing the whole search, so one press never loses what you typed.
  function onSearchKeyDown(e: React.KeyboardEvent) {
    if (!visible.length) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlighted((i) => (i + 1) % visible.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlighted((i) => (i <= 0 ? visible.length - 1 : i - 1))
    } else if (e.key === 'Escape' && highlighted >= 0) {
      e.preventDefault()
      setHighlighted(-1)
    }
  }

  const initial = userName?.[0]?.toUpperCase() ?? '?'

  return (
    // The right-hand control cluster of the global top bar (TrainerShell owns
    // the bar chrome). Streak, search, settings cog, account, help.
    <div className="flex items-center gap-1">
      <SaleComposer open={saleOpen} onClose={() => setSaleOpen(false)} currency={currency} />

      {/* Streak — a plain ghost circle until there's a streak, then an orange
          pill with the count. Matches the search/help circles when idle. */}
      {SHOW_STREAK && streak && (
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

      {/* Slide-out search with a scope selector + type-ahead. Borderless ghost
          circle when collapsed; grows into a bordered field when open, with a
          suggestion list hanging below it. */}
      <div ref={searchRef} className="relative">
        <form
          onSubmit={submitSearch}
          className={cn(
            'flex items-center rounded-full transition-[width,background-color] duration-200 overflow-hidden',
            searchOpen ? 'w-[19rem] lg:w-[22rem] border border-slate-200 bg-white shadow-sm' : 'w-9',
          )}
        >
          <button
            type="button"
            onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
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
                onKeyDown={onSearchKeyDown}
                placeholder={scope === 'breed' ? 'Search by breed…' : scope === 'dog' ? 'Search by dog…' : 'Search clients…'}
                aria-label="Search clients"
                autoComplete="off"
                role="combobox"
                aria-expanded={visible.length > 0}
                aria-controls="pm-search-suggestions"
                className="flex-1 min-w-0 h-9 bg-transparent px-2 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none"
              />
              {/* Explicit way out — clicking the magnifier to close isn't
                  discoverable once the field is full of text. */}
              <button
                type="button"
                onClick={closeSearch}
                aria-label="Close search"
                className="h-9 w-9 shrink-0 grid place-items-center rounded-full text-slate-400 transition-colors hover:text-slate-900 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </>
          )}
        </form>

        {searchOpen && query.trim().length >= MIN_QUERY && (
          <div
            id="pm-search-suggestions"
            role="listbox"
            className="absolute right-0 top-11 z-50 w-[19rem] lg:w-[22rem] overflow-hidden rounded-2xl border border-slate-200 bg-white py-1 shadow-lg"
          >
            {visible.length === 0 ? (
              <p className="px-4 py-3 text-sm text-slate-400">No matches.</p>
            ) : (
              visible.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  role="option"
                  aria-selected={i === highlighted}
                  // Mouse down, not click: the input's blur would otherwise tear
                  // the list down before the click landed.
                  onMouseDown={(e) => { e.preventDefault(); goToClient(s.id) }}
                  onMouseEnter={() => setHighlighted(i)}
                  className={cn(
                    'flex w-full items-center gap-3 px-3 py-2 text-left transition-colors',
                    i === highlighted ? 'bg-slate-50' : 'hover:bg-slate-50',
                  )}
                >
                  {s.dogPhotoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- arbitrary blob host, sized tiny
                    <img src={s.dogPhotoUrl} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
                  ) : (
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-100 text-xs font-semibold text-slate-400">
                      {s.name?.[0]?.toUpperCase() ?? '?'}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-900">{s.name ?? 'Unnamed client'}</span>
                    {(s.dogName || s.dogBreed) && (
                      <span className="block truncate text-xs text-slate-400">
                        {[s.dogName, s.dogBreed].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </span>
                </button>
              ))
            )}
            {/* Always reachable, so a search that suggests nothing useful can
                still land on the full results page. */}
            <button
              type="button"
              onMouseDown={(e) => { e.preventDefault(); runFullSearch() }}
              className="mt-1 flex w-full items-center gap-2 border-t border-slate-100 px-4 py-2.5 text-left text-xs font-medium text-[var(--pm-brand-700)] transition-colors hover:bg-slate-50"
            >
              <Search className="h-3.5 w-3.5" />
              See all results for “{query.trim()}”
            </button>
          </div>
        )}
      </div>

      {/* Create — the one place to start a new thing from anywhere in the app.
          Wears the same ghost circle as its neighbours rather than shouting as
          a filled primary; it sits in a row of tools, not above them. */}
      <div ref={addRef} className="relative">
        <button
          onClick={() => setAddOpen((v) => !v)}
          title="Create"
          aria-haspopup="menu"
          aria-expanded={addOpen}
          className="h-9 w-9 grid place-items-center rounded-full text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
        >
          <Plus className="h-[18px] w-[18px]" />
        </button>
        {addOpen && (
          <div
            role="menu"
            className="absolute right-0 mt-2 w-52 overflow-hidden rounded-2xl border border-slate-200 bg-white py-1 shadow-lg"
          >
            <button
              role="menuitem"
              onClick={() => { setAddOpen(false); router.push('/clients?new=1') }}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50"
            >
              <UserPlus className="h-4 w-4 text-slate-400" />
              New client
            </button>
            {canSell && (
              <button
                role="menuitem"
                onClick={() => { setAddOpen(false); setSaleOpen(true) }}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50"
              >
                <Receipt className="h-4 w-4 text-slate-400" />
                New sale
              </button>
            )}
          </div>
        )}
      </div>

      {/* Notifications bell — the in-app feed, with a live unread badge. */}
      <Link
        href="/notifications"
        title="Notifications"
        aria-label={notifCount > 0 ? `Notifications (${notifCount} unread)` : 'Notifications'}
        className="relative h-9 w-9 grid place-items-center rounded-full text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
      >
        <Bell className="h-[18px] w-[18px]" />
        {notifCount > 0 && (
          <span className="absolute top-0.5 right-0.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold leading-none text-white tabular-nums ring-2 ring-white">
            {notifCount > 9 ? '9+' : notifCount}
          </span>
        )}
      </Link>

      {/* Settings cog — moved out of the sidebar into the top-bar action row,
          sitting between search and the account control. */}
      <Link
        href="/settings"
        title="Settings"
        aria-label="Settings"
        className="h-9 w-9 grid place-items-center rounded-full text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
      >
        <Settings className="h-[18px] w-[18px]" />
      </Link>

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
    </div>
  )
}
