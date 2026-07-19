import { describe, it, expect } from 'vitest'
import { formatMoney, currencySymbol } from '@/lib/money'

// Pins the shared money.ts helpers that the whole currency-display sweep now
// depends on: every displayed price routes through these, so the symbol map
// (including ZAR, which older bespoke formatters were missing) must be correct.
describe('money.ts currency display helpers', () => {
  describe('currencySymbol', () => {
    it('maps gbp → £', () => {
      expect(currencySymbol('gbp')).toBe('£')
    })
    it('maps zar → R', () => {
      expect(currencySymbol('zar')).toBe('R')
    })
    it('maps nzd → $', () => {
      expect(currencySymbol('nzd')).toBe('$')
    })
    it('is case-insensitive', () => {
      expect(currencySymbol('GBP')).toBe('£')
    })
  })

  describe('formatMoney', () => {
    it('formats gbp cents with £ and 2dp', () => {
      expect(formatMoney(2500, 'gbp')).toBe('£25.00')
    })
    it('formats zar cents with R', () => {
      expect(formatMoney(2500, 'zar')).toBe('R25.00')
    })
    it('formats nzd cents with $', () => {
      expect(formatMoney(2500, 'nzd')).toBe('$25.00')
    })
  })
})
