// One-tap discount presets — the common deals a trainer reaches for, mirroring
// FM's quick-programme discounts. Each builds a create payload; the trainer sets
// the amount after adding. Shared by the editor UI.
import type { ModifierType, ApplyTo, DiscountCondition } from './evaluate'

export interface DiscountPreset {
  key: string
  label: string
  description: string
  modifierType: ModifierType
  modifierValue: number
  applyTo: ApplyTo
  conditions: DiscountCondition[]
}

export const DISCOUNT_PRESETS: DiscountPreset[] = [
  {
    key: 'whole_day',
    label: 'Whole-day rate',
    description: 'A set price when every part of a day is booked',
    modifierType: 'REPLACE',
    modifierValue: 0, // set the day price after adding
    applyTo: 'order_total',
    conditions: [{ key: 'booked_full_day' }],
  },
  {
    key: 'whole_week',
    label: 'Whole-week rate',
    description: 'A set price when the whole week is booked',
    modifierType: 'REPLACE',
    modifierValue: 0,
    applyTo: 'order_total',
    conditions: [{ key: 'booked_full_week' }],
  },
  {
    key: 'second_dog',
    label: 'Second-dog / sibling',
    description: '% off when more than one dog is booked together',
    modifierType: 'PERCENT',
    modifierValue: 25,
    applyTo: 'per_person',
    conditions: [{ key: 'group_size_min', operator: '>=', value: 2 }],
  },
  {
    key: 'early_bird',
    label: 'Early bird',
    description: 'A discount for booking before a date',
    modifierType: 'PERCENT',
    modifierValue: 10,
    applyTo: 'order_total',
    conditions: [{ key: 'booking_date_before', value: null }],
  },
  {
    key: 'custom',
    label: 'Custom',
    description: 'A plain discount that always applies',
    modifierType: 'PERCENT',
    modifierValue: 10,
    applyTo: 'order_total',
    conditions: [],
  },
]

export function presetByKey(key: string): DiscountPreset | undefined {
  return DISCOUNT_PRESETS.find(p => p.key === key)
}
