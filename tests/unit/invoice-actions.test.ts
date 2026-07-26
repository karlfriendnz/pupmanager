import { describe, it, expect } from 'vitest'
import { planInvoiceActions, type InvoiceActionKey } from '@/components/finances/invoice-actions'

// planInvoiceActions — which invoice actions the toolbar's "More" sheet offers,
// and in what order. The load-bearing promise is that collapsing the bar never
// DROPS an action: whatever the invoice's state, every action that is legal for
// it is reachable exactly once. Nothing sits in the header any more — Resend
// and View in Xero moved into the sheet with the rest.
const OPEN = { canSend: true, editable: true, payable: true, hasPayToken: true, loaded: true, hasXeroInvoice: true }

function reachable(s: Parameters<typeof planInvoiceActions>[0]): InvoiceActionKey[] {
  return planInvoiceActions(s).menu
}

describe('planInvoiceActions', () => {
  it('an open, synced invoice offers every action, Send first', () => {
    expect(planInvoiceActions(OPEN)).toEqual({
      menu: ['send', 'edit', 'copy', 'record', 'print', 'xero'],
    })
  })

  it('the header keeps nothing back — there is no primary slot', () => {
    expect(planInvoiceActions(OPEN)).not.toHaveProperty('primary')
  })

  it('a settled, unsynced invoice collapses to Print alone', () => {
    const plan = planInvoiceActions({ ...OPEN, canSend: false, editable: false, payable: false, hasPayToken: false, hasXeroInvoice: false })
    expect(plan).toEqual({ menu: ['print'] })
  })

  it('never offers the same action twice', () => {
    for (const canSend of [true, false]) {
      for (const editable of [true, false]) {
        for (const payable of [true, false]) {
          for (const hasPayToken of [true, false]) {
            for (const loaded of [true, false]) {
              for (const hasXeroInvoice of [true, false]) {
                const all = reachable({ canSend, editable, payable, hasPayToken, loaded, hasXeroInvoice })
                expect(new Set(all).size, JSON.stringify({ canSend, editable, payable, hasPayToken, loaded, hasXeroInvoice })).toBe(all.length)
              }
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

  it('Send (Resend) is reachable whenever the invoice can be sent', () => {
    expect(reachable({ ...OPEN, canSend: true })).toContain('send')
    expect(reachable({ ...OPEN, canSend: false })).not.toContain('send')
  })

  it('View in Xero only appears once the invoice reached Xero', () => {
    expect(reachable({ ...OPEN, hasXeroInvoice: false })).not.toContain('xero')
    expect(reachable({ ...OPEN, hasXeroInvoice: true })).toContain('xero')
  })

  it('Edit waits for the detail to load — it needs the line items', () => {
    expect(planInvoiceActions({ ...OPEN, loaded: false }).menu).not.toContain('edit')
    expect(planInvoiceActions({ ...OPEN, loaded: true }).menu).toContain('edit')
  })

  it('Copy pay link only appears once a pay token exists', () => {
    expect(planInvoiceActions({ ...OPEN, hasPayToken: false }).menu).not.toContain('copy')
    expect(planInvoiceActions({ ...OPEN, hasPayToken: true }).menu).toContain('copy')
  })

  it('a locked (non-editable) but still-owed invoice keeps Send, Copy and Record', () => {
    // e.g. PARTIAL: money has moved, so the lines are frozen, but it can still
    // be chased and paid off.
    const plan = planInvoiceActions({ ...OPEN, editable: false, hasXeroInvoice: false })
    expect(plan.menu).toEqual(['send', 'copy', 'record', 'print'])
  })

  it('a cancelled invoice collapses to Print alone', () => {
    expect(reachable({ canSend: false, editable: false, payable: false, hasPayToken: false, loaded: true, hasXeroInvoice: false }))
      .toEqual(['print'])
  })
})
