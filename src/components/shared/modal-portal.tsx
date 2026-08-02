'use client'

import { useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

// "Have we hydrated yet?" as an external store: the server snapshot is false and
// the client snapshot is true, and nothing ever changes after that — so the
// subscribe callback has nothing to do. This is the shape React sanctions for a
// render that must differ between the two passes; a setState-in-an-effect does
// the same job but is a cascading render, which the lint rule rightly rejects.
const neverChanges = () => () => {}
const onTheClient = () => true
const onTheServer = () => false

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
// Portals AFTER mount, not on the first client render. A portal cannot be
// hydrated against server HTML — React has to build it fresh — so an overlay
// that is already open when the page is server-rendered (the /clients/invite
// route IS its sheet) blew up with "Hydration failed": the server sent nothing
// here and the client's first pass produced a <div>. Rendering null until the
// effect runs makes both passes agree, then the portal appears a frame later.
//
// Every other caller opens on a click, long after mount, so nothing about them
// changes.
export function ModalPortal({ children }: { children: ReactNode }) {
  const hydrated = useSyncExternalStore(neverChanges, onTheClient, onTheServer)
  if (!hydrated || typeof document === 'undefined') return null
  return createPortal(children, document.body)
}
