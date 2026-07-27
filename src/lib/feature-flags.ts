// Client-safe feature flags (no prisma / server-only imports — safe to
// import from 'use client' components and the server alike).

// Temporary kill-switch for the PUBLIC (embed-form) class self-enrolment
// surface only: the public page, its API, and the package editor's
// "let clients self-enrol" toggle. Trainer-managed classes, roster,
// enrolment and the client view are unaffected. Flip to true to
// re-expose. Hidden 2026-05-16 — the public flow needs rework.
export const PUBLIC_CLASS_ENROLLMENT_ENABLED = false

// Packages (memberships) hidden from CLIENTS — Karl, 2026-07-27. The trainer
// nav and the Offerings hub hide them too, so leaving the client side live
// would let a client request a package the trainer has no menu entry to reach.
//
// Checked by the two client PAGES that list packages, not inside
// loadPublishedMemberships: this is a display decision, and putting it in the
// loader made that function return nothing for everyone — including the tests
// that prove its real behaviour, which we still need for when packages return.
//
// The e2e specs covering the client-facing package journey skip themselves off
// this flag, so flipping it back restores the feature AND its coverage with no
// stale test.skip left behind. Set to false to bring packages back; no data is
// touched either way.
export const PACKAGES_HIDDEN_FROM_CLIENTS = true
