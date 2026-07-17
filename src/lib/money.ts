// Pure money formatting — no DB, no cookies, no server-only imports, so it is
// safe to pull into a client component.
//
// This lives apart from client-invoices.ts on purpose: that module reaches for
// prisma + client-context (which imports next/headers), so importing anything
// from it inside a 'use client' component drags server-only code into the
// client bundle and fails the build. Keep this file dependency-free.

const CURRENCY_SYMBOLS: Record<string, string> = {
  nzd: '$', aud: '$', cad: '$', usd: '$', gbp: '£', eur: '€', zar: 'R',
}

/** Minor units (cents) → a display string, e.g. 2500 + "nzd" → "$25.00". */
export function formatMoney(minor: number, currency: string): string {
  const sym = CURRENCY_SYMBOLS[currency.toLowerCase()] ?? ''
  return `${sym}${(minor / 100).toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** The bare currency symbol, for prefixing an amount input. */
export function currencySymbol(currency: string): string {
  return CURRENCY_SYMBOLS[currency.toLowerCase()] ?? ''
}
