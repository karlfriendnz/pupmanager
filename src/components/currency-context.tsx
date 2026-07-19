'use client'

import { createContext, useContext } from 'react'

// Makes the active trainer's base currency available to any client component
// under the trainer (or client) app shell, so prices render in the right
// symbol without threading `currency` through every server parent. Pair with
// `formatMoney`/`currencySymbol` from '@/lib/money' to render an amount.
const CurrencyContext = createContext<string>('nzd')

export function CurrencyProvider({ currency, children }: { currency: string; children: React.ReactNode }) {
  return <CurrencyContext.Provider value={currency}>{children}</CurrencyContext.Provider>
}

/** The active trainer's base currency, lower-case ISO (e.g. 'nzd', 'gbp'). */
export function useCurrency(): string {
  return useContext(CurrencyContext)
}
