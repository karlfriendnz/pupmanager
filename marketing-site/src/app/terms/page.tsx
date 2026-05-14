import type { Metadata } from 'next'
import Link from 'next/link'
import { Container } from '@/components/Container'

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'The terms that apply when you use PupManager.',
}

// TODO before relying on this in production:
//  - Replace [LEGAL ENTITY NAME] with the registered company that owns PupManager
//  - Replace [REGISTERED ADDRESS] with the postal address
//  - Have a lawyer review — particularly the limitation-of-liability and
//    governing-law clauses, and the auto-renew subscription mechanics if you
//    enable Apple/Google in-app purchases.
const LAST_UPDATED = '2026-05-06'

export default function TermsPage() {
  return (
    <section className="py-20">
      <Container className="max-w-3xl">
        <p className="text-sm font-medium text-brand-700">Legal</p>
        <h1 className="mt-3 text-5xl font-semibold tracking-tight text-ink-900">Terms of Service</h1>
        <p className="mt-4 text-sm text-ink-500">Last updated: {formatDate(LAST_UPDATED)}</p>

        <nav className="mt-10 rounded-2xl border border-ink-100 bg-ink-50 p-6 text-sm">
          <p className="font-semibold text-ink-900">On this page</p>
          <ol className="mt-3 grid gap-2 md:grid-cols-2">
            {toc.map((t, i) => (
              <li key={t.id}>
                <a href={`#${t.id}`} className="text-brand-700 hover:text-brand-800">
                  {i + 1}. {t.label}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <article className="prose prose-slate mt-12 max-w-none prose-a:text-brand-700 prose-headings:scroll-mt-16 prose-headings:tracking-tight">
          <p>
            These terms govern your use of <strong>PupManager</strong> — including the website at
            pupmanager.com, the application at app.pupmanager.com, and the iOS and Android mobile
            apps (together, the "Service"). By creating an account or otherwise using the Service,
            you agree to these terms.
          </p>
          <p>
            We've kept the language plain. If something here is unclear, email{' '}
            <a href="mailto:info@pupmanager.com">info@pupmanager.com</a>.
          </p>

          <h2 id="who-we-are">1. Who we are</h2>
          <p>
            PupManager is operated by <strong>[LEGAL ENTITY NAME]</strong>, a New Zealand company
            registered at <strong>82 Kingswood Road, Brookfield, Tauranga, New Zealand</strong>.
            In these terms, "we", "us", and "our" refer to that company. "You" means the person
            or business agreeing to these terms.
          </p>

          <h2 id="who-can-use">2. Who can use the Service</h2>
          <ul>
            <li>You must be at least 16 years old.</li>
            <li>If you're using the Service on behalf of a business, you represent that you have
              authority to bind that business to these terms.</li>
            <li>You must provide accurate account information and keep it up to date.</li>
            <li>You're responsible for everything that happens under your account, so keep your
              login credentials private.</li>
          </ul>

          <h2 id="trainer-vs-client">3. Trainer accounts vs. client accounts</h2>
          <p>
            PupManager has two kinds of users:
          </p>
          <ul>
            <li><strong>Trainers</strong> sign up directly and pay for their subscription. The
              trainer owns the relationship with their own clients.</li>
            <li><strong>Clients</strong> are invited by their trainer. Clients sign in via a
              one-time code emailed to them and don't pay PupManager directly.</li>
          </ul>
          <p>
            <strong>If you're a trainer:</strong> the personal information you enter about your
            clients (and their dogs) is yours to manage. You're the data controller for that
            information; PupManager is your data processor. You're responsible for having a lawful
            basis to collect and process it under the privacy laws that apply to you.
          </p>
          <p>
            <strong>If you're a client:</strong> your trainer chose PupManager to manage your
            sessions, homework, and records. You can request access to or correction of your
            information from your trainer or directly from us at any time.
          </p>

          <h2 id="acceptable-use">4. Acceptable use</h2>
          <p>You agree not to:</p>
          <ul>
            <li>Use the Service to break the law, infringe anyone's rights, or harass anyone.</li>
            <li>Upload viruses, malicious code, or content that's illegal, defamatory, or
              obscene.</li>
            <li>Scrape, crawl, or extract data from the Service except via features we provide for
              that purpose.</li>
            <li>Reverse-engineer, decompile, or attempt to derive the source code of the Service
              (except where applicable law expressly permits it).</li>
            <li>Use the Service to compete with us — for example, to build a competing product.</li>
            <li>Disrupt or place an unreasonable load on our infrastructure.</li>
            <li>Resell, sublicense, or share access to the Service outside of your subscription.</li>
          </ul>
          <p>
            We may suspend or terminate accounts that breach these rules — see §10.
          </p>

          <h2 id="subscriptions">5. Subscriptions, billing, and refunds</h2>
          <ul>
            <li>Pricing is published on our <Link href="/pricing">pricing page</Link> and is
              charged in the currency listed there. Local taxes (e.g. GST, VAT, sales tax) may be
              added at checkout where required.</li>
            <li>Paid plans renew automatically at the end of each billing period unless you cancel
              before the renewal date.</li>
            <li>You can cancel any time from your account settings. Cancellation takes effect at
              the end of the current billing period; we don't pro-rate partial periods.</li>
            <li>We don't generally offer refunds for unused portions of a subscription, but if
              something has gone wrong on our side, email{' '}
              <a href="mailto:info@pupmanager.com">info@pupmanager.com</a> and we'll make it
              right.</li>
            <li>If your payment fails, we'll attempt to recharge over the next few days. If it
              keeps failing we may suspend access until you update your billing details.</li>
          </ul>
          <p>
            <strong>Apple App Store / Google Play purchases</strong> (if applicable): subscriptions
            purchased through Apple or Google are billed and managed by them. To cancel, manage the
            subscription in your App Store or Google Play account; their terms also apply to those
            purchases.
          </p>

          <h2 id="your-content">6. Your content</h2>
          <p>
            You keep ownership of all the content you put into PupManager — session notes,
            homework, videos, photos, client records, anything else. You give us a worldwide,
            royalty-free license to host, store, copy, transmit, and display that content solely
            so we can provide the Service to you (for example, showing your client their
            homework).
          </p>
          <p>
            You're responsible for making sure you have the right to upload anything you put into
            the Service. If you delete content, we'll remove it from active systems within a
            reasonable period; see the{' '}
            <Link href="/privacy#retention">privacy policy</Link> for retention specifics.
          </p>

          <h2 id="our-content">7. Our content and the Service</h2>
          <p>
            The Service itself — the software, the design, the brand, the documentation — is owned
            by us or our licensors. Subject to these terms, we grant you a non-exclusive,
            non-transferable license to use the Service for your dog-training business during the
            term of your subscription. Nothing in these terms transfers any of our intellectual
            property rights to you.
          </p>

          <h2 id="changes-to-service">8. Changes to the Service</h2>
          <p>
            We're actively building PupManager and the Service will change over time. We may add,
            change, or remove features. If we materially reduce a paid feature you depend on,
            we'll give you advance notice and a refund for the unused portion of your subscription
            if you choose to cancel.
          </p>

          <h2 id="availability">9. Availability and "as-is"</h2>
          <p>
            We work hard to keep the Service running and your data safe — see{' '}
            <Link href="/privacy#security">our security practices</Link>. But the Service is
            provided <strong>"as is"</strong> and we don't promise it will be uninterrupted,
            error-free, or always available. To the maximum extent permitted by law, we disclaim
            all warranties (express or implied) other than those that cannot legally be excluded.
          </p>
          <p>
            <strong>If you're a consumer</strong> in a jurisdiction with non-excludable consumer
            guarantees (e.g. New Zealand's Consumer Guarantees Act, the Australian Consumer Law,
            EU consumer law), nothing in these terms removes those guarantees.
          </p>

          <h2 id="suspension-termination">10. Suspension and termination</h2>
          <p>
            You can stop using the Service or delete your account at any time. We may suspend or
            terminate your account if you breach these terms, if your use puts the Service or
            other users at risk, or if we are required to by law. Where the situation allows, we
            will give you advance notice and an opportunity to fix the problem.
          </p>
          <p>
            On termination, sections that by their nature should survive (intellectual property,
            limitation of liability, indemnity, governing law) continue to apply. For data
            handling on termination see the{' '}
            <Link href="/privacy#account-deletion">privacy policy</Link>.
          </p>

          <h2 id="liability">11. Limitation of liability</h2>
          <p>
            To the maximum extent permitted by law, our total aggregate liability to you for any
            claim arising out of or relating to the Service is limited to the amount you paid us
            in the twelve (12) months immediately before the event giving rise to the claim, or
            NZ$100, whichever is greater.
          </p>
          <p>
            We are not liable for any indirect, incidental, consequential, special, or punitive
            damages, including lost profits, lost revenue, lost data, or business interruption,
            even if we've been advised of the possibility of those losses.
          </p>
          <p>
            Some jurisdictions don't allow these limitations. If you live in one of them, the
            limitations above apply only to the extent permitted by your local law.
          </p>

          <h2 id="indemnity">12. Indemnity</h2>
          <p>
            You agree to defend and indemnify us against any third-party claim arising from (a)
            your use of the Service in breach of these terms, (b) content you upload that
            infringes someone else's rights, or (c) your handling of your clients' personal
            information in breach of applicable privacy law.
          </p>

          <h2 id="governing-law">13. Governing law and disputes</h2>
          <p>
            These terms are governed by the laws of <strong>New Zealand</strong>. The courts of
            New Zealand have exclusive jurisdiction over disputes arising from these terms or the
            Service, unless your local consumer law gives you the non-waivable right to bring
            proceedings in your country of residence.
          </p>
          <p>
            Before filing a formal dispute, please email us at{' '}
            <a href="mailto:info@pupmanager.com">info@pupmanager.com</a> and give us 30 days to
            try to resolve it informally.
          </p>

          <h2 id="changes-to-terms">14. Changes to these terms</h2>
          <p>
            We'll update these terms as the Service evolves. The "Last updated" date at the top
            shows the most recent change. For material changes affecting your rights, we'll notify
            active accounts by email at least 30 days before the change takes effect, so you have
            time to review and (if you don't agree) cancel.
          </p>

          <h2 id="contact">15. Contact</h2>
          <p>
            Questions about these terms? Email{' '}
            <a href="mailto:info@pupmanager.com">info@pupmanager.com</a>.
          </p>
        </article>

        <div className="mt-16 rounded-2xl border border-ink-100 bg-ink-50 p-6 text-sm text-ink-700">
          See also our <Link href="/privacy" className="text-brand-700 hover:text-brand-800">Privacy Policy</Link>.
        </div>
      </Container>
    </section>
  )
}

const toc = [
  { id: 'who-we-are', label: 'Who we are' },
  { id: 'who-can-use', label: 'Who can use the Service' },
  { id: 'trainer-vs-client', label: 'Trainer vs. client accounts' },
  { id: 'acceptable-use', label: 'Acceptable use' },
  { id: 'subscriptions', label: 'Subscriptions and billing' },
  { id: 'your-content', label: 'Your content' },
  { id: 'our-content', label: 'Our content and the Service' },
  { id: 'changes-to-service', label: 'Changes to the Service' },
  { id: 'availability', label: 'Availability and "as-is"' },
  { id: 'suspension-termination', label: 'Suspension and termination' },
  { id: 'liability', label: 'Limitation of liability' },
  { id: 'indemnity', label: 'Indemnity' },
  { id: 'governing-law', label: 'Governing law and disputes' },
  { id: 'changes-to-terms', label: 'Changes to these terms' },
  { id: 'contact', label: 'Contact' },
]

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}
