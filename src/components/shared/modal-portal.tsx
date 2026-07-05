'use client'

import { type ReactNode } from 'react'
import { createPortal } from 'react-dom'

// Renders its children into <body> via a React portal so a modal's
// `position: fixed` overlay anchors to the real viewport.
//
// Why this exists: several modals are opened from PageHeader actions / menus,
// which are portaled into the desktop top bar. That bar uses `backdrop-blur`
// (backdrop-filter), and a filtered ancestor establishes a containing block
// for `position: fixed` descendants — so a `fixed inset-0` overlay would size
// to the ~56px bar instead of the viewport and render clipped at the top.
// Portaling the overlay to <body> escapes that containing block.
//
// SSR-safe: returns null on the server (no `document`). Callers only mount this
// after a client-side open toggle, so there's no hydration mismatch.
export function ModalPortal({ children }: { children: ReactNode }) {
  if (typeof document === 'undefined') return null
  return createPortal(children, document.body)
}
