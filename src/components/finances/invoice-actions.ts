// Which invoice actions the document toolbar shows, and where.
//
// Five bordered buttons (Edit / Copy pay link / Print / Record payment /
// Resend) overflowed a 390px bar — labels wrapped onto three lines and the last
// button ran off the screen edge. The bar now carries the close control plus
// ONE primary action; everything else moves into the "More" sheet.
//
// Kept pure and apart from the JSX so the rule "no action is ever dropped" is
// testable rather than eyeballed.

export type InvoiceActionKey = 'send' | 'print' | 'edit' | 'copy' | 'record'

export interface InvoiceActionState {
  /** UNPAID or PARTIAL — anything still owed can be emailed (again). */
  canSend: boolean
  /** UNPAID only; a paid or cancelled invoice is locked. */
  editable: boolean
  /** Still open, so a public pay link / manual payment makes sense. */
  payable: boolean
  /** The detail fetch produced a pay token. */
  hasPayToken: boolean
  /** The detail has loaded — Edit needs the line items. */
  loaded: boolean
}

export interface InvoiceActionPlan {
  /** The single action that earns a slot in the bar. */
  primary: 'send' | 'print'
  /** Everything else, in the order the sheet lists it. */
  menu: InvoiceActionKey[]
}

/**
 * Send takes the primary slot whenever the invoice can be sent: it's the only
 * action that moves the invoice toward being paid, and it's the reason a
 * trainer opens an unpaid invoice at all. Once nothing can be sent (paid or
 * cancelled) Print takes the slot — that's what's left worth doing to a settled
 * invoice — and it drops out of the menu so it is never offered twice.
 */
export function planInvoiceActions(s: InvoiceActionState): InvoiceActionPlan {
  const primary = s.canSend ? 'send' : 'print'
  const menu: InvoiceActionKey[] = []
  if (s.editable && s.loaded) menu.push('edit')
  if (s.payable && s.hasPayToken) menu.push('copy')
  if (s.payable) menu.push('record')
  if (primary === 'send') menu.push('print')
  return { primary, menu }
}
