'use client'

import { useEffect, useRef, useState } from 'react'
import type { PluginListenerHandle } from '@capacitor/core'
import { Check, Loader2, Nfc, TriangleAlert } from 'lucide-react'
import { FullScreenSheet } from '@/components/shared/full-screen-sheet'
import { formatMoney } from '@/lib/money'
import {
  TapToPayNative,
  serveConnectionTokens,
  type TapToPayStage,
} from '@/lib/tap-to-pay-native'

// The screen a client looks at while they hold their card against the trainer's
// phone.
//
// It exists because a tap is the one moment in this app where a STRANGER is
// looking at a trainer's screen, deciding whether to trust it with a card. So:
// the amount is the biggest thing on it, the merchant name is the trainer's,
// and there is nothing else — no nav, no logo, no upsell. A full screen, not a
// toast over the till.
//
// The order of operations is Stripe's and is not negotiable:
//
//   1. answer connection-token requests   (BEFORE connecting — Stripe asks during it)
//   2. connect this phone as a reader     (the SDK refuses until Apple's terms are accepted)
//   3. collect + confirm                  (the tap itself; AUTHORISES, does not capture)
//   4. capture, on the server             (the money actually moves)
//
// Step 4 being separate is deliberate and is the safety in the whole design: if
// the app dies between 3 and 4 the client is left with an authorisation that
// expires by itself in about two days, rather than a charge for something they
// never received. And it is not what marks the sale paid either — the Connect
// webhook does that off `payment_intent.succeeded`, exactly as it does for a QR
// payment, so a capture whose HTTP response never arrives still settles.

export interface TapToPayIntent {
  paymentId: string
  clientSecret: string
  /** Minor units. */
  amount: number
  currency: string
}

type Phase = TapToPayStage | 'idle'

/** What the person holding the card should be reading, per phase. */
const HEADLINE: Record<Phase, string> = {
  idle: 'Getting ready',
  connecting: 'Getting ready',
  ready: 'Ready',
  waiting_for_card: 'Hold the card near the top of the phone',
  processing: 'Taking payment',
  done: 'Paid',
  failed: 'Not taken',
}

export function TapToPaySheet({
  intent,
  merchantName,
  onClose,
  onPaid,
}: {
  intent: TapToPayIntent
  /** The TRAINER's business name — whose name a stranger reads off this screen. */
  merchantName: string | null
  onClose: () => void
  /** Fired once the server has captured. The sale is settled by the webhook, not by this. */
  onPaid: () => void
}) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  // The flow must run exactly once per sheet. React 18's development double-mount
  // would otherwise open the NFC field twice and leave one of them orphaned.
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true

    let cancelled = false
    const handles: PluginListenerHandle[] = []

    void (async () => {
      try {
        // 1. The token server. Registered first, because Stripe asks for a token
        //    DURING connect and a listener added afterwards misses the only
        //    request that matters.
        handles.push(await serveConnectionTokens())
        handles.push(
          await TapToPayNative.addListener('tapToPayStatus', (e) => {
            if (!cancelled) setPhase(e.stage)
          }),
        )

        // 2. Connect. Reaching the other side of this is proof the trainer has
        //    accepted Apple's terms — Stripe will not connect otherwise — so it
        //    is the one moment we can record that, and we record it there.
        setPhase('connecting')
        await TapToPayNative.connect()
        if (cancelled) return
        void fetch('/api/terminal/reader-connected', { method: 'POST' }).catch(() => {})

        // 3. The tap.
        setPhase('waiting_for_card')
        await TapToPayNative.collect({ clientSecret: intent.clientSecret })
        if (cancelled) return

        // 4. Capture, server-side, against a Payment row we own.
        setPhase('processing')
        const res = await fetch('/api/terminal/capture', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paymentId: intent.paymentId }),
        })
        if (cancelled) return
        if (!res.ok) {
          // The card WAS authorised — say so, or a trainer will take the money
          // a second way and charge the client twice. An uncaptured hold
          // disappears on its own; a double charge does not.
          setPhase('failed')
          setError('The card was accepted but we couldn’t finish. Don’t take payment again — check Finances in a minute.')
          return
        }
        setPhase('done')
        onPaid()
      } catch (err) {
        if (cancelled) return
        setPhase('failed')
        setError(readableError(err))
      }
    })()

    return () => {
      cancelled = true
      // Close the NFC field before the screen goes. Leaving it open is how a
      // phone ends up reading the next card that comes near it.
      void TapToPayNative.cancel().catch(() => {})
      for (const handle of handles) void handle.remove().catch(() => {})
    }
    // Runs once. `intent` is fixed for the life of the sheet — the composer
    // mounts a new one per sale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const busy = phase !== 'done' && phase !== 'failed'

  return (
    <FullScreenSheet
      title="Tap to pay"
      sub={merchantName ?? undefined}
      onClose={onClose}
      footer={
        <button
          type="button"
          onClick={onClose}
          className="min-h-11 w-full rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white active:bg-slate-800"
        >
          {phase === 'done' ? 'Done' : busy ? 'Cancel' : 'Close'}
        </button>
      }
    >
      <div className="flex flex-col items-center gap-6 py-10 text-center">
        {/* The amount, first and largest. It is what the cardholder is agreeing
            to, and it should be readable at arm's length across a counter. */}
        <p className="text-4xl font-semibold tabular-nums text-slate-900">
          {formatMoney(intent.amount, intent.currency)}
        </p>

        <div className="grid h-20 w-20 place-items-center">
          {phase === 'done' ? (
            <Check className="h-12 w-12 text-slate-900" strokeWidth={1.75} />
          ) : phase === 'failed' ? (
            <TriangleAlert className="h-12 w-12 text-slate-900" strokeWidth={1.75} />
          ) : phase === 'waiting_for_card' ? (
            <Nfc className="h-12 w-12 text-slate-900" strokeWidth={1.75} />
          ) : (
            <Loader2 className="h-10 w-10 animate-spin text-slate-400" strokeWidth={1.75} />
          )}
        </div>

        <div className="space-y-2">
          <p className="text-lg font-medium text-slate-900">{HEADLINE[phase]}</p>
          {error ? (
            <p className="mx-auto max-w-xs text-sm text-slate-600">{error}</p>
          ) : phase === 'waiting_for_card' ? (
            <p className="mx-auto max-w-xs text-sm text-slate-500">
              A card, a phone or a watch — anything contactless.
            </p>
          ) : phase === 'done' ? (
            <p className="mx-auto max-w-xs text-sm text-slate-500">
              The receipt and the sale are being filed now.
            </p>
          ) : null}
        </div>
      </div>
    </FullScreenSheet>
  )
}

/**
 * Turn whatever the native side threw into something a trainer can act on.
 *
 * The two that matter are the ones with a customer waiting: they moved the card
 * too early, or they haven't done Apple's paperwork. Everything else gets an
 * honest "nothing was charged", which is the fact that actually settles a
 * trainer's nerves.
 */
function readableError(err: unknown): string {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  const text = raw.toLowerCase()
  if (text.includes('cancel')) return 'Cancelled. Nothing was charged.'
  if (text.includes('terms') || text.includes('onboard')) {
    return 'Apple’s terms haven’t been accepted for this business yet — Settings → Payments has the link. Nothing was charged.'
  }
  if (text.includes('declin')) return 'The card was declined. Nothing was charged — try another card.'
  return 'That didn’t go through. Nothing was charged — try again.'
}
