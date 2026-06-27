'use client'

import { useState, useTransition } from 'react'
import { resubscribeSubscriber } from './actions'

export function ResubscribeSubscriberButton({ token }: { token: string }) {
  const [done, setDone] = useState(false)
  const [pending, start] = useTransition()

  if (done) {
    return <p className="text-sm font-medium text-teal-600">You&rsquo;re subscribed again — welcome back!</p>
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(async () => {
        const res = await resubscribeSubscriber(token)
        if (res.ok) setDone(true)
      })}
      className="text-sm font-medium text-slate-500 underline underline-offset-2 hover:text-slate-700 disabled:opacity-50"
    >
      {pending ? 'Resubscribing…' : 'Unsubscribed by mistake? Resubscribe'}
    </button>
  )
}
