'use client'

import { createContext, useContext, type ReactNode } from 'react'

// Is a TRAINER looking at this screen through the client preview, rather than
// the client themselves?
//
// The API already refuses to buy, book, enrol or cancel in preview, and it has
// to: those are real charges and real seats on somebody else's account, and a
// trainer clicking around their own app must not create them. What was missing
// was telling the SCREEN, so the buttons sat there looking live and the only
// way to learn they weren't was to press one and get a red "Preview mode —
// payment disabled".
//
// One provider on the client layout, which already knows. Anything that acts on
// the client's behalf reads it and says so up front instead.
const Ctx = createContext(false)

export function PreviewProvider({ value, children }: { value: boolean; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** True while a trainer is previewing. Use it to disable, not to hide. */
export function useIsPreview(): boolean {
  return useContext(Ctx)
}

/** The one sentence to show wherever an action is off for this reason. */
export const PREVIEW_REASON = 'You’re previewing — this is what your client sees. Only they can do this.'
