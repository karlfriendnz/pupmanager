'use client'

import { useEffect, useState } from 'react'

const SHOWN_KEY = 'pm-onboarding-celebrated'

// Emoji-driven firework burst. Twelve particles radiate from the centre on
// random vectors, each with a slight rotation + scale-in/out. CSS-only so
// no canvas/dep required, and the animation auto-replays via the keyed
// remount when the burst index changes.
const PARTICLES = ['🎉', '✨', '🎆', '🎊', '⭐', '💥']
const BURST_DELAYS = [0, 220, 460] // staggered second + third bursts

interface Props {
  allComplete: boolean
}

// One-shot fullscreen celebration when the trainer crosses the onboarding
// finish line. Fired the FIRST time the trainer renders a layout with
// allComplete=true. After dismissal (or auto-timeout) the sessionStorage
// flag stops it firing again — they get the moment once, then onboarding
// quietly disappears.
export function OnboardingCelebration({ allComplete }: Props) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!allComplete) return
    if (sessionStorage.getItem(SHOWN_KEY) === '1') return
    sessionStorage.setItem(SHOWN_KEY, '1')
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVisible(true)
    const timer = setTimeout(() => setVisible(false), 5500)
    return () => clearTimeout(timer)
  }, [allComplete])

  if (!visible) return null

  return (
    <div
      role="dialog"
      aria-label="Onboarding complete"
      onClick={() => setVisible(false)}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm cursor-pointer animate-pm-celebration-fade"
    >
      {/* Particle layer — three staggered bursts radiating from the centre. */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {BURST_DELAYS.map((delay, b) => (
          <div key={b} className="absolute left-1/2 top-1/2">
            {Array.from({ length: 14 }).map((_, i) => {
              const angle = (360 / 14) * i + b * 12
              const distance = 220 + (b * 20)
              const dx = Math.cos((angle * Math.PI) / 180) * distance
              const dy = Math.sin((angle * Math.PI) / 180) * distance
              return (
                <span
                  key={i}
                  className="absolute -translate-x-1/2 -translate-y-1/2 text-2xl select-none animate-pm-firework-particle"
                  style={
                    {
                      '--dx': `${dx}px`,
                      '--dy': `${dy}px`,
                      animationDelay: `${delay}ms`,
                    } as React.CSSProperties
                  }
                >
                  {PARTICLES[(i + b) % PARTICLES.length]}
                </span>
              )
            })}
          </div>
        ))}
      </div>

      {/* Centre card */}
      <div className="relative z-10 max-w-md mx-6 px-8 py-10 rounded-3xl bg-white text-center shadow-[0_30px_80px_-20px_rgba(99,102,241,0.55)] animate-pm-celebration-pop">
        <p className="text-6xl mb-3 select-none">🎉</p>
        <h2 className="text-3xl font-bold bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 bg-clip-text text-transparent">
          Wahoo!
        </h2>
        <p className="mt-2 text-base font-semibold text-slate-900">
          You&apos;ve completed your onboarding.
        </p>
        <p className="mt-1.5 text-sm text-slate-500 leading-snug">
          Your training business is set up. Time to do what you do best — train dogs.
        </p>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setVisible(false) }}
          className="mt-6 inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow hover:shadow-lg transition-shadow"
        >
          Let&apos;s go
        </button>
      </div>
    </div>
  )
}
