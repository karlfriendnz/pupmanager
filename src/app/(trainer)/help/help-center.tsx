'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Search, ListChecks, HelpCircle, MessageSquare, Lightbulb, Bug, Map,
  ChevronDown, ArrowUpRight, X, PawPrint, ArrowRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { HELP_ARTICLES, HELP_CATEGORIES, HELP_FAQS, type HelpArticle } from '@/lib/help/content'
import { SupportTicketForm, type SupportFormType } from './support-ticket-form'

// Where "What's coming" links to. PLACEHOLDER — point this at the real public
// roadmap page on the marketing site once it exists.
const ROADMAP_URL = 'https://pupmanager.com/roadmap'

export function HelpCenter() {
  const [query, setQuery] = useState('')
  const [openArticle, setOpenArticle] = useState<string | null>(null)
  const [modal, setModal] = useState<SupportFormType | null>(null)

  const q = query.trim().toLowerCase()
  const results = useMemo(() => {
    if (!q) return []
    return HELP_ARTICLES.filter(a =>
      a.title.toLowerCase().includes(q) ||
      a.summary.toLowerCase().includes(q) ||
      a.category.toLowerCase().includes(q) ||
      a.keywords.some(k => k.toLowerCase().includes(q)) ||
      a.steps.some(s => s.toLowerCase().includes(q)),
    )
  }, [q])

  return (
    <div className="w-full max-w-5xl mx-auto px-4 md:px-8 py-6">
      {/* Hero + search */}
      <div
        className="relative overflow-hidden rounded-3xl px-6 py-8 sm:py-10 text-white shadow-[0_18px_48px_-16px_rgba(42,157,169,0.55)]"
        style={{ backgroundImage: 'linear-gradient(135deg, var(--pm-brand-500), var(--pm-brand-700))' }}
      >
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.10] flex items-center justify-end gap-6 pr-4">
          <PawPrint className="h-28 w-28 rotate-12 -translate-y-3" strokeWidth={1.25} />
          <PawPrint className="h-20 w-20 -rotate-6 translate-y-8" strokeWidth={1.25} />
        </div>
        <div aria-hidden className="pointer-events-none absolute -top-16 -left-10 h-48 w-48 rounded-full bg-white/15 blur-2xl" />
        <div className="relative max-w-xl">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">How can we help?</h1>
          <p className="text-white/85 mt-1.5 text-sm sm:text-base">
            Search the guides below, or pick an option to get in touch.
          </p>
          <div className="relative mt-5">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
            <input
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search for help — e.g. invite a client, set hours…"
              className="w-full h-12 rounded-2xl bg-white pl-12 pr-4 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:outline-none focus:ring-4 focus:ring-white/40"
            />
          </div>
        </div>
      </div>

      {q ? (
        // ── Search results ──────────────────────────────────────────────────
        <div className="mt-8">
          <p className="text-sm text-slate-500 mb-3">
            {results.length} {results.length === 1 ? 'result' : 'results'} for &ldquo;{query}&rdquo;
          </p>
          {results.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center">
              <p className="text-slate-600 text-sm">No guides matched that. Try different words, or get in touch below.</p>
              <button
                onClick={() => setModal('support')}
                className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--pm-brand-700)] hover:underline"
              >
                <MessageSquare className="h-4 w-4" /> Contact support
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {results.map(a => (
                <ArticleRow key={a.slug} article={a} open={openArticle === a.slug} onToggle={() => setOpenArticle(openArticle === a.slug ? null : a.slug)} showCategory />
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          {/* ── Action cards ─────────────────────────────────────────────── */}
          <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <ActionCard as="link" href="/dashboard" icon={ListChecks} title="Continue setup" desc="Pick up your welcome checklist." />
            <ActionCard as="anchor" href="#faqs" icon={HelpCircle} title="Read the FAQs" desc="Quick answers to common questions." />
            <ActionCard as="button" onClick={() => setModal('support')} icon={MessageSquare} title="Get in touch" desc="Message our support team." />
            <ActionCard as="button" onClick={() => setModal('feature')} icon={Lightbulb} title="Request a feature" desc="Tell us what to build next." />
            <ActionCard as="button" onClick={() => setModal('bug')} icon={Bug} title="Report a bug" desc="Something not working? Let us know." />
            <ActionCard as="external" href={ROADMAP_URL} icon={Map} title="What's coming" desc="See what we're working on next." />
          </div>

          {/* ── Browse all guides ────────────────────────────────────────── */}
          <div className="mt-10">
            <h2 className="text-lg font-bold text-slate-900 mb-4">Browse all guides</h2>
            <div className="flex flex-col gap-7">
              {HELP_CATEGORIES.map(category => {
                const articles = HELP_ARTICLES.filter(a => a.category === category)
                if (articles.length === 0) return null
                return (
                  <div key={category}>
                    <p className="text-xs font-bold uppercase tracking-wide text-[var(--pm-brand-700)] mb-2">{category}</p>
                    <div className="flex flex-col gap-2">
                      {articles.map(a => (
                        <ArticleRow key={a.slug} article={a} open={openArticle === a.slug} onToggle={() => setOpenArticle(openArticle === a.slug ? null : a.slug)} />
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* ── FAQs ─────────────────────────────────────────────────────── */}
          <div id="faqs" className="mt-10 scroll-mt-6">
            <h2 className="text-lg font-bold text-slate-900 mb-4">Frequently asked questions</h2>
            <div className="flex flex-col gap-2">
              {HELP_FAQS.map(f => (
                <FaqRow key={f.q} q={f.q} a={f.a} open={openArticle === `faq:${f.q}`} onToggle={() => setOpenArticle(openArticle === `faq:${f.q}` ? null : `faq:${f.q}`)} />
              ))}
            </div>
          </div>
        </>
      )}

      {modal && (
        <FormModal type={modal} onClose={() => setModal(null)} />
      )}
    </div>
  )
}

// ─── Article row (expands to numbered steps) ─────────────────────────────────
function ArticleRow({ article, open, onToggle, showCategory }: { article: HelpArticle; open: boolean; onToggle: () => void; showCategory?: boolean }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-900 text-sm">{article.title}</p>
          <p className="text-xs text-slate-500 mt-0.5 truncate">
            {showCategory && <span className="text-[var(--pm-brand-700)] font-medium">{article.category} · </span>}
            {article.summary}
          </p>
        </div>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <ol className="px-4 pb-4 pt-1 flex flex-col gap-2">
          {article.steps.map((step, i) => (
            <li key={i} className="flex gap-3 text-sm text-slate-700">
              <span
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--pm-brand-50)] text-[11px] font-bold tabular-nums"
                style={{ color: 'var(--pm-brand-700)' }}
              >
                {i + 1}
              </span>
              <span className="leading-snug">{step}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function FaqRow({ q, a, open, onToggle }: { q: string; a: string; open: boolean; onToggle: () => void }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors">
        <p className="min-w-0 flex-1 font-medium text-slate-900 text-sm">{q}</p>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform', open && 'rotate-180')} />
      </button>
      {open && <p className="px-4 pb-4 pt-1 text-sm text-slate-600 leading-relaxed">{a}</p>}
    </div>
  )
}

// ─── Action card ─────────────────────────────────────────────────────────────
type ActionCardProps = {
  icon: React.ComponentType<{ className?: string }>
  title: string
  desc: string
} & (
  | { as: 'button'; onClick: () => void; href?: never }
  | { as: 'link' | 'anchor' | 'external'; href: string; onClick?: never }
)

function ActionCard({ icon: Icon, title, desc, ...rest }: ActionCardProps) {
  const inner = (
    <>
      <span
        className="grid place-items-center h-10 w-10 rounded-xl text-white shrink-0"
        style={{ backgroundColor: 'var(--pm-brand-600)' }}
      >
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-slate-900 text-sm flex items-center gap-1">
          {title}
          {rest.as === 'external' && <ArrowUpRight className="h-3.5 w-3.5 text-slate-400" />}
        </p>
        <p className="text-xs text-slate-500 mt-0.5">{desc}</p>
      </div>
      <ArrowRight className="h-4 w-4 shrink-0 self-center text-slate-300 transition-all group-hover:text-[var(--pm-brand-600)] group-hover:translate-x-0.5" />
    </>
  )
  const cls = 'group flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left hover:border-[var(--pm-brand-500)] hover:shadow-sm transition-all'

  if (rest.as === 'button') return <button onClick={rest.onClick} className={cls}>{inner}</button>
  if (rest.as === 'link') return <Link href={rest.href} className={cls}>{inner}</Link>
  if (rest.as === 'anchor') return <a href={rest.href} className={cls}>{inner}</a>
  return <a href={rest.href} target="_blank" rel="noopener noreferrer" className={cls}>{inner}</a>
}

// ─── Form modal (get in touch / feature / bug) ───────────────────────────────
const MODAL_META: Record<SupportFormType, { title: string; blurb: string }> = {
  support: { title: 'Get in touch', blurb: "Tell us what you need and we'll email you back." },
  feedback: { title: 'Share feedback', blurb: 'We read every message — thank you!' },
  feature: { title: 'Request a feature', blurb: 'What would make PupManager better for you?' },
  bug: { title: 'Report a bug', blurb: 'Tell us what went wrong so we can fix it.' },
}

function FormModal({ type, onClose }: { type: SupportFormType; onClose: () => void }) {
  const meta = MODAL_META[type]
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3 sm:p-4 bg-slate-950/60 backdrop-blur-md" onClick={onClose}>
      <div className="relative w-full max-w-lg bg-white rounded-3xl shadow-[0_20px_60px_-12px_rgba(0,0,0,0.4)] overflow-hidden" onClick={e => e.stopPropagation()}>
        <div
          className="px-6 py-5 text-white"
          style={{ backgroundImage: 'linear-gradient(135deg, var(--pm-brand-500), var(--pm-brand-700))' }}
        >
          <button type="button" aria-label="Close" onClick={onClose} className="absolute top-3.5 right-3.5 grid place-items-center h-8 w-8 rounded-full bg-white/15 text-white hover:bg-white/25">
            <X className="h-4 w-4" />
          </button>
          <h2 className="text-lg font-bold">{meta.title}</h2>
          <p className="text-sm text-white/85 mt-0.5">{meta.blurb}</p>
        </div>
        <div className="p-6">
          <SupportTicketForm type={type} onDone={onClose} />
        </div>
      </div>
    </div>
  )
}
