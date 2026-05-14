'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { submitContact } from '@/app/contact/actions'

export function ContactForm() {
  const [state, action] = useActionState(submitContact, { ok: null })

  if (state.ok === true) {
    return (
      <div className="rounded-2xl border border-brand-200 bg-brand-50 p-8 text-ink-900">
        <h2 className="text-xl font-semibold">Thanks — message received.</h2>
        <p className="mt-2 text-ink-700">We'll reply from <strong>info@pupmanager.com</strong> within one business day.</p>
      </div>
    )
  }

  return (
    <form action={action} className="space-y-5">
      {/* Honeypot — hidden from users, visible to bots. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Website
          <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <Field id="name" label="Your name" required>
        <input
          id="name"
          name="name"
          type="text"
          required
          maxLength={200}
          autoComplete="name"
          className={inputCls}
        />
      </Field>

      <Field id="email" label="Email" required>
        <input
          id="email"
          name="email"
          type="email"
          required
          maxLength={320}
          autoComplete="email"
          className={inputCls}
        />
      </Field>

      <Field id="role" label="I'm a…" hint="Optional — helps us route your message.">
        <select id="role" name="role" defaultValue="" className={inputCls}>
          <option value="">Choose one</option>
          <option value="trainer">Working trainer</option>
          <option value="trainer-curious">Trainer just looking</option>
          <option value="client">Dog owner / client</option>
          <option value="press">Press</option>
          <option value="partner">Potential partner</option>
          <option value="other">Other</option>
        </select>
      </Field>

      <Field id="message" label="Message" required>
        <textarea
          id="message"
          name="message"
          required
          maxLength={5000}
          rows={6}
          className={inputCls}
        />
      </Field>

      {state.ok === false && (
        <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{state.error}</p>
      )}

      <SubmitButton />
      <p className="text-xs text-ink-500">
        We reply from info@pupmanager.com. Usually within one business day.
      </p>
    </form>
  )
}

function Field({
  id,
  label,
  required,
  hint,
  children,
}: {
  id: string
  label: string
  required?: boolean
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-ink-900">
        {label} {required && <span className="text-brand-700">*</span>}
      </label>
      {hint && <p className="mt-1 text-xs text-ink-500">{hint}</p>}
      <div className="mt-1.5">{children}</div>
    </div>
  )
}

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-brand-600 px-5 py-2.5 font-medium text-white hover:bg-brand-700 disabled:opacity-60"
    >
      {pending ? 'Sending…' : 'Send message'}
    </button>
  )
}

const inputCls =
  'w-full rounded-md border border-ink-300 bg-white px-4 py-2.5 text-ink-900 placeholder:text-ink-500 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20'
