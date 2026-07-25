import { describe, it, expect } from 'vitest'
import { NOTIFICATION_TYPES } from '@/lib/notification-types'
import { iconForNotification } from '@/components/shared/notification-icon'
import { Bell } from 'lucide-react'

// Every notification the app can send has to arrive looking like itself. The
// registry (copy, trigger, audience) is typed against the Prisma enum so it
// can't drift — but the ICON map is a plain Record<string, …> with a bell
// fallback, so a new type silently renders as a generic bell and nobody
// notices. CLIENT_PAYMENT_REQUEST — "please pay this invoice", the one with
// money on the end of it — shipped exactly that way.

const ALL_TYPES = Object.keys(NOTIFICATION_TYPES)

describe('every notification type is fully wired', () => {
  it('has a registry entry whose type matches its key', () => {
    for (const [key, meta] of Object.entries(NOTIFICATION_TYPES)) {
      expect(meta.type, `${key} is filed under the wrong type`).toBe(key)
    }
  })

  it('has its own icon — no type falls back to the generic bell', () => {
    const bells = ALL_TYPES.filter(t => iconForNotification(t) === Bell)
    expect(
      bells,
      `these types render as a plain bell, so they read like every other notification: ${bells.join(', ')}`,
    ).toEqual([])
  })

  it('still falls back to a bell for an unknown or legacy null type', () => {
    // Legacy rows carry no type at all; they must render, not crash.
    expect(iconForNotification(null)).toBe(Bell)
    expect(iconForNotification(undefined)).toBe(Bell)
    expect(iconForNotification('SOMETHING_REMOVED_LATER')).toBe(Bell)
  })

  it('gives every type the copy needed to render a message', () => {
    const thin = ALL_TYPES.filter(t => {
      const meta = NOTIFICATION_TYPES[t as keyof typeof NOTIFICATION_TYPES]
      return !meta.label?.trim() || !meta.description?.trim()
    })
    expect(thin, `types missing a label or description: ${thin.join(', ')}`).toEqual([])
  })

  it('covers both audiences — trainer and client', () => {
    // A quick sanity check that the registry hasn't lost a whole side of the
    // app: both the trainer's own alerts and the dog owner's are present.
    expect(ALL_TYPES).toContain('NEW_MESSAGE')
    expect(ALL_TYPES).toContain('CLIENT_NEW_MESSAGE')
    expect(ALL_TYPES).toContain('CLIENT_PAYMENT_REQUEST')
    expect(ALL_TYPES.length).toBeGreaterThanOrEqual(23)
  })
})
