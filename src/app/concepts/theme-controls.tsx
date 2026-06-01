'use client'

import { useState } from 'react'

// Live white-label controls for the bake-off: the trainer's brand colour drives
// --accent (background + accents everywhere), and their font colour drives
// --accent-fg (text/icons on branded surfaces like the menu). Everything else
// derives via color-mix, so changing these re-skins all three phones at once.
const BRANDS = [
  { name: 'Teal', v: '#2a9da9' },
  { name: 'Indigo', v: '#4f46e5' },
  { name: 'Coral', v: '#ef5b3b' },
  { name: 'Violet', v: '#7c3aed' },
  { name: 'Forest', v: '#1f7a52' },
  { name: 'Charcoal', v: '#334155' },
]
const FONTS = [
  { name: 'White', v: '#ffffff' },
  { name: 'Ink', v: '#0f1f24' },
]

export function ThemeControls({ children }: { children: React.ReactNode }) {
  const [brand, setBrand] = useState('#2a9da9')
  const [font, setFont] = useState('#ffffff')
  return (
    <div style={{ ['--accent' as string]: brand, ['--accent-fg' as string]: font } as React.CSSProperties}>
      <div className="mx-auto mb-8 flex w-fit max-w-full flex-wrap items-center justify-center gap-x-8 gap-y-3 rounded-2xl bg-white px-5 py-3.5 shadow-sm">
        <div className="flex items-center gap-2.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Brand</span>
          {BRANDS.map(b => (
            <button
              key={b.v} onClick={() => setBrand(b.v)} title={b.name}
              className={['h-7 w-7 rounded-full ring-2 ring-offset-2 transition', brand === b.v ? 'ring-slate-800' : 'ring-transparent'].join(' ')}
              style={{ backgroundColor: b.v }}
            />
          ))}
        </div>
        <div className="flex items-center gap-2.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Font</span>
          {FONTS.map(f => (
            <button
              key={f.v} onClick={() => setFont(f.v)} title={f.name}
              className={['h-7 w-7 rounded-full border border-slate-200 ring-2 ring-offset-2 transition', font === f.v ? 'ring-slate-800' : 'ring-transparent'].join(' ')}
              style={{ backgroundColor: f.v }}
            />
          ))}
        </div>
      </div>
      {children}
    </div>
  )
}
