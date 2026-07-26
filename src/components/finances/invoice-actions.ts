// Which invoice actions the document toolbar offers, and in what order.
//
// Five bordered buttons (Edit / Copy pay link / Print / Record payment /
// Resend) overflowed a 390px bar — labels wrapped onto three lines and the last
// button ran off the screen edge. The bar first collapsed to close + ONE
// primary action + "More"; it now carries the close control and "More" alone,
// so the header stays clean whatever state the invoice is in. EVERY action —
// including Resend and View in Xero — lives in the sheet.
//
// Kept pure and apart from the JSX so the rule "no action is ever dropped" is
// testable rather than eyeballed.

export type InvoiceActionKey = 'send' | 'print' | 'edit' | 'copy' | 'record' | 'xero'

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
  /** The invoice reached Xero, so it can be opened in the trainer's org. */
  hasXeroInvoice: boolean
}

export interface InvoiceActionPlan {
  /** Everything the toolbar's "More" sheet lists, in the order it lists it. */
  menu: InvoiceActionKey[]
}

/**
 * Order follows what a trainer opens an invoice to DO. Send is first — it's the
 * only action that moves the invoice toward being paid, and it's the reason the
 * invoice was opened at all. Then the ways to change or settle it, then the two
 * that take it somewhere else (a printer, Xero).
 *
 * Print is unconditional: every invoice can be printed or saved as a PDF, even
 * a cancelled one.
 */
export function planInvoiceActions(s: InvoiceActionState): InvoiceActionPlan {
  const menu: InvoiceActionKey[] = []
  if (s.canSend) menu.push('send')
  if (s.editable && s.loaded) menu.push('edit')
  if (s.payable && s.hasPayToken) menu.push('copy')
  if (s.payable) menu.push('record')
  menu.push('print')
  if (s.hasXeroInvoice) menu.push('xero')
  return { menu }
}
