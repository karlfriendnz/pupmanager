import { describe, it, expect } from 'vitest'
import { planInvoiceActions, type InvoiceActionKey } from '@/components/finances/invoice-actions'

// planInvoiceActions — which invoice action earns the toolbar's one visible
// slot, and which move into the "More" sheet. The load-bearing promise is that
// collapsing the bar never DROPS an action: whatever the invoice's state, every
// action that is legal for it is reachable exactly once.
const OPEN = { canSend: true, editable: true, payable: true, hasPayToken: true, loaded: true }

function reachable(s: Parameters<typeof planInvoiceActions>[0]): InvoiceActionKey[] {
  const p = planInvoiceActions(s)
  return [p.primary, ...p.menu]
}

describe('planInvoiceActions', () => {
  it('an open, sendable invoice offers Send in the bar and the rest behind More', () => {
    expect(planInvoiceActions(OPEN)).toEqual({
      primary: 'send',
      menu: ['edit', 'copy', 'record', 'print'],
    })
  })

  it('a settled invoice cannot be sent, so Print takes the primary slot', () => {
    const plan = planInvoiceActions({ ...OPEN, canSend: false, editable: false, payable: false, hasPayToken: false })
    expect(plan).toEqual({ primary: 'print', menu: [] })
  })

  it('never offers the same action twice', () => {
    for (const canSend of [true, false]) {
      for (const editable of [true, false]) {
        for (const payable of [true, false]) {
          for (const hasPayToken of [true, false]) {
            for (const loaded of [true, false]) {
              const all = reachable({ canSend, editable, payable, hasPayToken, loaded })
              expect(new Set(all).size, JSON.stringify({ canSend, editable, payable, hasPayToken, loaded })).toBe(all.length)
            }
          }
        }
      }
    }
  })

  it('Print is always reachable, whatever the invoice state', () => {
    for (const canSend of [true, false]) {
      expect(reachable({ ...OPEN, canSend })).toContain('print')
    }
  })

  it('Send is reachable whenever the invoice can be sent', () => {
    expect(reachable({ ...OPEN, canSend: true })).toContain('send')
    expect(reachable({ ...OPEN, canSend: false })).not.toContain('send')
  })

  it('Edit waits for the detail to load — it needs the line items', () => {
    expect(planInvoiceActions({ ...OPEN, loaded: false }).menu).not.toContain('edit')
    expect(planInvoiceActions({ ...OPEN, loaded: true }).menu).toContain('edit')
  })

  it('Copy pay link only appears once a pay token exists', () => {
    expect(planInvoiceActions({ ...OPEN, hasPayToken: false }).menu).not.toContain('copy')
    expect(planInvoiceActions({ ...OPEN, hasPayToken: true }).menu).toContain('copy')
  })

  it('a locked (non-editable) but still-owed invoice keeps Copy, Record and Send', () => {
    // e.g. PARTIAL: money has moved, so the lines are frozen, but it can still
    // be chased and paid off.
    const plan = planInvoiceActions({ ...OPEN, editable: false })
    expect(plan.primary).toBe('send')
    expect(plan.menu).toEqual(['copy', 'record', 'print'])
  })

  it('a cancelled invoice collapses to Print alone', () => {
    expect(reachable({ canSend: false, editable: false, payable: false, hasPayToken: false, loaded: true }))
      .toEqual(['print'])
  })
})
