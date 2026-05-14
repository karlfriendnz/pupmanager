import type { Metadata } from 'next'
import { Container } from '@/components/Container'
import { ContactForm } from '@/components/ContactForm'

export const metadata: Metadata = {
  title: 'Contact',
  description:
    'Email us at info@pupmanager.com or use the form. We reply within one business day.',
}

export default function ContactPage() {
  return (
    <section className="py-20">
      <Container className="max-w-5xl">
        <p className="text-sm font-medium text-brand-700">Contact</p>
        <h1 className="mt-3 text-5xl font-semibold tracking-tight text-ink-900">Say hi. A real person will answer.</h1>
        <p className="mt-5 max-w-xl text-lg text-ink-700">
          Questions, feedback, a feature you wish we had — write to us. No bots, no tickets, no
          phone tree. Just a real person who reads every email.
        </p>

        <div className="mt-12 grid gap-12 md:grid-cols-5">
          <aside className="md:col-span-2">
            <h2 className="text-lg font-semibold text-ink-900">Other ways to reach us</h2>
            <dl className="mt-6 space-y-5 text-sm">
              <div>
                <dt className="font-medium text-ink-900">Email</dt>
                <dd className="mt-1">
                  <a href="mailto:info@pupmanager.com" className="text-brand-700 hover:text-brand-800">
                    info@pupmanager.com
                  </a>
                </dd>
              </div>
              <div>
                <dt className="font-medium text-ink-900">How fast we reply</dt>
                <dd className="mt-1 text-ink-700">Same day, most days. Within one working day, always.</dd>
              </div>
              <div>
                <dt className="font-medium text-ink-900">Privacy or data questions</dt>
                <dd className="mt-1 text-ink-700">
                  Same email. Have a read of our{' '}
                  <a href="/privacy" className="text-brand-700 hover:text-brand-800">privacy policy</a>{' '}
                  too.
                </dd>
              </div>
            </dl>
          </aside>

          <div className="md:col-span-3">
            <ContactForm />
          </div>
        </div>
      </Container>
    </section>
  )
}
