'use client'

// Live preview for the lead-magnet editor — a scaled-down render of the chosen
// landing layout (classic / split / minimal / none) or the delivery email,
// driven by the editor's current form state. Approximates the public page in
// src/app/c/[slug]/free/[magnetSlug]/page.tsx (kept deliberately lightweight).

export interface PreviewProps {
  mode: 'page' | 'email'
  layout: string
  title: string
  intro: string
  imageUrl: string | null
  emailSubject: string
  emailIntro: string
  accent: string
  businessName: string
  logoUrl: string | null
  consentText: string
}

function shade(hex: string): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  const r = Math.max(0, ((n >> 16) & 255) - 40), g = Math.max(0, ((n >> 8) & 255) - 40), b = Math.max(0, (n & 255) - 40)
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

function PreviewLogo({ logoUrl, accent, businessName, size = 40 }: { logoUrl: string | null; accent: string; businessName: string; size?: number }) {
  if (logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={logoUrl} alt="" style={{ maxHeight: size, maxWidth: size * 2.6 }} className="object-contain" />
  }
  return (
    <div className="flex items-center justify-center rounded-xl font-bold text-white" style={{ width: size, height: size, background: accent, fontSize: size * 0.42 }}>
      {(businessName || 'P').charAt(0).toUpperCase()}
    </div>
  )
}

function MiniForm({ accent, consentText }: { accent: string; consentText: string }) {
  return (
    <div className="mt-2">
      <div className="mb-1.5 h-7 rounded-lg border border-slate-200 bg-white px-2 text-[10px] leading-7 text-slate-400">Your name</div>
      <div className="mb-1.5 h-7 rounded-lg border border-slate-200 bg-white px-2 text-[10px] leading-7 text-slate-400">you@email.com</div>
      <div className="mb-2 flex items-start gap-1.5 text-left text-[8px] leading-tight text-slate-400">
        <span className="mt-0.5 h-2.5 w-2.5 flex-shrink-0 rounded border border-slate-300" />
        <span>{consentText}</span>
      </div>
      <div className="flex h-8 items-center justify-center rounded-lg text-[11px] font-semibold text-white" style={{ background: `linear-gradient(135deg, ${accent}, ${shade(accent)})` }}>↓ Email me the download</div>
      <p className="mt-2 text-center text-[7px] uppercase tracking-wider text-slate-400">Powered by <b style={{ color: accent }}>PupManager</b></p>
    </div>
  )
}

function PreviewShell({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="flex h-full min-h-[300px] items-center justify-center rounded-2xl p-5" style={style ?? { background: '#f4f7f9' }}>
      {children}
    </div>
  )
}

export function LeadMagnetPreview(p: PreviewProps) {
  const { accent, businessName, logoUrl } = p
  const title = p.title.trim() || 'Your free download'
  const intro = p.intro.trim()
  const form = <MiniForm accent={accent} consentText={p.consentText} />

  // ── Email preview ──
  if (p.mode === 'email') {
    return (
      <PreviewShell>
        <div className="w-[260px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div style={{ height: 4, background: accent }} />
          <div className="px-4 pt-4 text-center"><div className="flex justify-center"><PreviewLogo logoUrl={logoUrl} accent={accent} businessName={businessName} size={36} /></div><p className="mt-1.5 text-[10px] font-semibold">{businessName}</p></div>
          <div className="px-4 pb-4 pt-2 text-left">
            <p className="text-[10px] text-slate-700">Hi there,</p>
            <p className="mt-1 text-[10px] leading-snug text-slate-600">{p.emailIntro.trim() || `Thanks for signing up — here's your copy of ${title}.`}</p>
            <div className="mx-auto mt-3 flex h-8 w-[150px] items-center justify-center rounded-lg text-[10px] font-semibold text-white" style={{ background: `linear-gradient(135deg, ${accent}, ${shade(accent)})` }}>Download {title.slice(0, 14)}</div>
          </div>
          <div className="border-t border-slate-100 bg-slate-50 px-4 py-2 text-[8px] text-slate-400">Subject: <span className="text-slate-600">{p.emailSubject.trim() || `Your free download: ${title}`}</span></div>
        </div>
      </PreviewShell>
    )
  }

  // ── Page previews ──
  if (p.layout === 'split') {
    return (
      <PreviewShell>
        <div className="grid w-[320px] grid-cols-2 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col justify-center gap-1.5 p-3 text-white" style={p.imageUrl ? { backgroundImage: `linear-gradient(150deg, ${accent}dd, ${shade(accent)}b3), url(${p.imageUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' } : { background: `linear-gradient(150deg, ${accent}, ${shade(accent)})` }}>
            <span className="text-[7px] font-bold uppercase tracking-widest text-white/80">Free download</span>
            <div className="text-[13px] font-bold leading-tight">{title}</div>
            {intro && <div className="text-[8px] leading-snug text-white/90">{intro}</div>}
          </div>
          <div className="p-3"><PreviewLogo logoUrl={logoUrl} accent={accent} businessName={businessName} size={26} />{form}</div>
        </div>
      </PreviewShell>
    )
  }

  if (p.layout === 'minimal') {
    return (
      <PreviewShell>
        <div className="w-[230px] rounded-xl border border-slate-200 bg-white p-4 text-center shadow-sm">
          <span className="inline-block rounded-full px-2 py-0.5 text-[7px] font-bold uppercase tracking-wide" style={{ background: `${accent}1a`, color: accent }}>Free download</span>
          <div className="mt-1.5 text-[20px] font-extrabold leading-tight text-slate-900">{title}</div>
          {intro && <p className="mt-1 text-[9px] leading-snug text-slate-600">{intro}</p>}
          <div className="mt-2 text-left">{form}</div>
        </div>
      </PreviewShell>
    )
  }

  if (p.layout === 'none') {
    return (
      <PreviewShell>
        <div className="w-[230px] rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm">
          {title && <div className="text-[13px] font-semibold text-slate-900">{title}</div>}
          {intro && <p className="mt-0.5 text-[9px] leading-snug text-slate-600">{intro}</p>}
          <MiniForm accent="#0f172a" consentText={p.consentText} />
        </div>
      </PreviewShell>
    )
  }

  // classic (default)
  return (
    <PreviewShell>
      <div className="w-[240px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {p.imageUrl ? <div className="h-20 bg-cover bg-center" style={{ backgroundImage: `url(${p.imageUrl})` }} /> : <div style={{ height: 4, background: accent }} />}
        <div className={`px-4 text-center ${p.imageUrl ? '' : 'pt-4'}`}>
          <div className={`flex justify-center ${p.imageUrl ? '-mt-5' : ''}`}><span className={p.imageUrl ? 'rounded-xl bg-white p-0.5 shadow-sm' : ''}><PreviewLogo logoUrl={logoUrl} accent={accent} businessName={businessName} size={34} /></span></div>
          <p className="mt-1 text-[10px] font-semibold">{businessName}</p>
        </div>
        <div className="px-4 pb-4 pt-1 text-left">
          <div className="text-[14px] font-bold leading-tight text-slate-900">{title}</div>
          {intro && <p className="mt-1 text-[9px] leading-snug text-slate-600">{intro}</p>}
          {form}
        </div>
      </div>
    </PreviewShell>
  )
}
