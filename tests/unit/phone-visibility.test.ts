import { describe, it, expect } from 'vitest'

// Phone visibility to clients.
//
// NOTE ON COVERAGE: there is no extractable helper or API for this rule. The
// decision lives inline in the client-facing server component
// src/app/(client)/my-help/page.tsx (line ~61):
//
//     {trainer.showPhoneToClients && trainer.phone && ( ...tel link... )}
//
// The trainer's `phone` IS selected and sent to that component regardless, so the
// privacy guarantee rests ENTIRELY on the `showPhoneToClients` flag gating the
// render. A server component can't be unit-tested in isolation here (it pulls in
// next/navigation + prisma + getActiveClient), so this test codifies the exact
// gating predicate as a pure function mirroring the JSX. If the inline condition
// ever changes (e.g. someone drops the flag check, or flips the default), update
// this predicate to match — and treat a divergence as a real privacy regression.
//
// Schema context: TrainerProfile.showPhoneToClients defaults to FALSE, so a
// trainer's phone is private unless they explicitly opt in.

// Mirrors the inline condition in my-help/page.tsx exactly.
function clientCanSeePhone(trainer: { showPhoneToClients: boolean; phone: string | null }): boolean {
  return Boolean(trainer.showPhoneToClients && trainer.phone)
}

describe('phone visibility — client-facing trainer contact (mirrors my-help inline gate)', () => {
  it('OMITS the phone when showPhoneToClients is false (the default), even if a phone is on file', () => {
    expect(clientCanSeePhone({ showPhoneToClients: false, phone: '021123456' })).toBe(false)
  })

  it('SHOWS the phone only when the trainer has opted in AND a phone exists', () => {
    expect(clientCanSeePhone({ showPhoneToClients: true, phone: '021123456' })).toBe(true)
  })

  it('OMITS the phone when opted in but no phone is on file', () => {
    expect(clientCanSeePhone({ showPhoneToClients: true, phone: null })).toBe(false)
  })

  it('OMITS the phone for an empty-string phone even when opted in', () => {
    expect(clientCanSeePhone({ showPhoneToClients: true, phone: '' })).toBe(false)
  })

  it('default-deny: a freshly-created profile (flag false) never leaks the phone', () => {
    // Models the schema default — showPhoneToClients starts false.
    const freshProfile = { showPhoneToClients: false, phone: '0800-trainer' }
    expect(clientCanSeePhone(freshProfile)).toBe(false)
  })
})
