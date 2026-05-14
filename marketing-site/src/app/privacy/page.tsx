import type { Metadata } from 'next'
import Link from 'next/link'
import { Container } from '@/components/Container'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description:
    'How PupManager collects, uses, and protects your information — including data handled inside the iOS and Android apps.',
}

// TODO before App Store submission:
//  - Replace [LEGAL ENTITY NAME] with the registered company that owns PupManager
//  - Replace [REGISTERED ADDRESS] with the postal address
//  - Confirm jurisdiction line ("New Zealand law") if incorporated elsewhere
//  - If you have a DPO or EU representative, swap the contact line accordingly
//  - Have a lawyer review before relying on this in production
const LAST_UPDATED = '2026-05-06'

export default function PrivacyPage() {
  return (
    <section className="py-20">
      <Container className="max-w-3xl">
        <p className="text-sm font-medium text-brand-700">Legal</p>
        <h1 className="mt-3 text-5xl font-semibold tracking-tight text-ink-900">Privacy Policy</h1>
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
            This policy explains what information PupManager collects, why we collect it, how we
            use it, and the choices you have. It applies to <strong>pupmanager.com</strong>, the{' '}
            <strong>app at app.pupmanager.com</strong>, and the <strong>PupManager iOS and Android
            apps</strong>.
          </p>

          <p>
            We've written this in plain English because we'd rather you read it than skim it. If
            something here is unclear, email us at{' '}
            <a href="mailto:info@pupmanager.com">info@pupmanager.com</a> and we'll explain.
          </p>

          <h2 id="who-we-are">1. Who we are</h2>
          <p>
            PupManager is operated by <strong>[LEGAL ENTITY NAME]</strong>, registered at{' '}
            <strong>82 Kingswood Road, Brookfield, Tauranga, New Zealand</strong>. For the
            purposes of data-protection law (including the GDPR and the NZ Privacy Act 2020), we
            are the data controller for the information you give us as a trainer or client.
          </p>

          <h2 id="what-we-collect">2. What we collect</h2>
          <p>We collect only what we need to run the service. In practice, that means:</p>

          <h3>Account information (trainers)</h3>
          <ul>
            <li>Your name, business name, email, and password (stored hashed — never in plain text).</li>
            <li>Profile details you choose to add: phone, photo, bio, business address.</li>
            <li>Billing details when you subscribe (handled by our payments processor — see §4).</li>
          </ul>

          <h3>Account information (clients of trainers)</h3>
          <ul>
            <li>Name, email, and any contact details your trainer adds when inviting you.</li>
            <li>Information about your dog: name, breed, age, vaccination status, behavior notes,
              and similar — added by you or your trainer.</li>
            <li>Sign-in is via a one-time code sent to your email; we don't store a password for
              client accounts.</li>
          </ul>

          <h3>Training and business data</h3>
          <ul>
            <li>Sessions, attendance, homework, progress notes, scores, and any video or photo
              attachments you upload.</li>
            <li>Schedules, package credits, group-class enrollments, and similar operational data.</li>
          </ul>

          <h3>Device and usage data</h3>
          <ul>
            <li>IP address, device type, browser or app version, OS version, language, and approximate
              region (derived from IP).</li>
            <li>Usage events — e.g. pages visited, features used, errors encountered — to help us
              fix bugs and prioritize improvements.</li>
            <li>Push-notification tokens (Apple Push Notification service / Firebase Cloud
              Messaging) when you enable notifications.</li>
          </ul>

          <h3>What we do not collect</h3>
          <ul>
            <li>Precise geolocation. We use approximate region only.</li>
            <li>Contacts, photo library, microphone, or camera unless you explicitly use a feature
              that requires it (e.g. attaching a video to a session note).</li>
            <li>Health data, advertising identifiers (IDFA), or cross-site tracking cookies.</li>
            <li>Children's data — see §9.</li>
          </ul>

          <h2 id="how-we-use">3. How we use your information</h2>
          <ul>
            <li><strong>To run the service</strong> — show you your sessions, deliver homework to
              clients, send appointment reminders, sync calendars, etc.</li>
            <li><strong>To communicate with you</strong> — transactional email (booking
              confirmations, password resets, billing receipts), and product updates if you've
              opted in.</li>
            <li><strong>To improve the product</strong> — aggregated usage data tells us what's
              working and what isn't.</li>
            <li><strong>To keep accounts secure</strong> — detecting unusual sign-in activity, rate
              limiting, fraud prevention.</li>
            <li><strong>To meet legal obligations</strong> — tax records, lawful requests from
              authorities, and similar.</li>
          </ul>
          <p>We do not use your data to train AI models. We do not sell your data. We do not
          show you third-party ads inside PupManager.</p>

          <h2 id="who-we-share-with">4. Who we share information with</h2>
          <p>
            PupManager is built on top of a small number of trusted infrastructure providers
            ("subprocessors"). They process your data on our instructions and are bound by data
            protection terms.
          </p>
          <table>
            <thead>
              <tr>
                <th>Provider</th>
                <th>What they do for us</th>
                <th>Where</th>
              </tr>
            </thead>
            <tbody>
              {subprocessors.map((p) => (
                <tr key={p.name}>
                  <td><strong>{p.name}</strong></td>
                  <td>{p.purpose}</td>
                  <td>{p.region}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            We share your data with these providers only as needed to deliver the service. We don't
            share your personal data with anyone else except where we are legally required to (e.g.
            a court order), or where you ask us to (e.g. exporting your data to another tool).
          </p>

          <h2 id="retention">5. How long we keep it</h2>
          <ul>
            <li><strong>Active account data</strong> — for as long as your account is active.</li>
            <li><strong>After account deletion</strong> — within 30 days we delete or irreversibly
              anonymize your personal data, except where we are legally required to retain it (e.g.
              tax records for 7 years in most jurisdictions).</li>
            <li><strong>Server logs</strong> — typically 30 days, unless flagged for security
              investigation.</li>
            <li><strong>Backups</strong> — encrypted backups roll off within 35 days.</li>
          </ul>

          <h2 id="your-rights">6. Your rights</h2>
          <p>Wherever you live, you can:</p>
          <ul>
            <li><strong>Access</strong> the personal data we hold about you.</li>
            <li><strong>Correct</strong> anything that's wrong.</li>
            <li><strong>Export</strong> a machine-readable copy of your data.</li>
            <li><strong>Delete</strong> your account and your personal data (see §7).</li>
            <li><strong>Object</strong> to processing or <strong>withdraw consent</strong> for
              optional uses (e.g. product update emails).</li>
          </ul>
          <h3>If you live in the EU, UK, or Switzerland (GDPR / UK GDPR)</h3>
          <p>
            You also have the right to <strong>restrict</strong> processing, the right to{' '}
            <strong>data portability</strong>, the right to <strong>object</strong> to processing
            based on our legitimate interests, and the right to lodge a complaint with your local
            supervisory authority.
          </p>
          <p>
            Our lawful bases for processing your data are: (a) <strong>contract</strong> — to
            deliver the service you signed up for; (b) <strong>legitimate interests</strong> — for
            security, fraud prevention, and product improvement; (c) <strong>consent</strong> —
            for optional things like product update emails; and (d) <strong>legal obligation</strong>{' '}
            — where retention or disclosure is required by law.
          </p>

          <h3>If you live in California (CCPA / CPRA)</h3>
          <p>
            You have the right to know what personal information we collect, the right to delete
            it, the right to correct it, the right to opt out of the "sale" or "sharing" of
            personal information, and the right not to be discriminated against for exercising
            these rights. <strong>We do not sell or share your personal information</strong> as
            those terms are defined under the CCPA, and we do not use your data for cross-context
            behavioral advertising.
          </p>

          <h3>If you live in Australia (Privacy Act 1988 / APPs)</h3>
          <p>
            We handle your personal information in accordance with the Australian Privacy Principles.
            You can request access to or correction of your personal information. If you have a
            complaint about how we've handled your data, contact us first; if you're not satisfied
            with our response, you can complain to the{' '}
            <a href="https://www.oaic.gov.au/" target="_blank" rel="noopener noreferrer">
              Office of the Australian Information Commissioner
            </a>.
          </p>

          <h3>If you live in New Zealand (Privacy Act 2020)</h3>
          <p>
            We handle your personal information in accordance with the Information Privacy
            Principles in the Privacy Act 2020. You have the right to access and request correction
            of your personal information. Complaints can be made to the{' '}
            <a href="https://www.privacy.org.nz/" target="_blank" rel="noopener noreferrer">
              Office of the Privacy Commissioner
            </a>.
          </p>

          <p>
            To exercise any of these rights, email{' '}
            <a href="mailto:info@pupmanager.com">info@pupmanager.com</a> from the address on
            your account. We respond within 30 days (or sooner where the law requires it).
          </p>

          <h2 id="account-deletion">7. Deleting your account</h2>
          <p>You can delete your PupManager account and all associated personal data at any time:</p>
          <ul>
            <li><strong>In the iOS or Android app:</strong> Settings → Account → Delete account.</li>
            <li><strong>On the web:</strong> Settings → Account → Delete account at{' '}
              <a href="https://app.pupmanager.com/settings">app.pupmanager.com/settings</a>.</li>
            <li><strong>By email:</strong> request deletion from{' '}
              <a href="mailto:info@pupmanager.com">info@pupmanager.com</a> using the email
              address on your account.</li>
          </ul>
          <p>
            Deletion is irreversible. Within 30 days of your request we delete or irreversibly
            anonymize your personal data on our active systems and roll-off in backups within 35
            days. Records we are legally required to keep (e.g. invoices for tax purposes) are
            retained for the minimum period required and then deleted.
          </p>
          <p>
            <strong>Trainers, please note:</strong> when you delete your account, the records of
            your clients' dogs that you created stay with the affected client accounts. If you want
            us to also delete client records, request it explicitly.
          </p>

          <h2 id="security">8. Security</h2>
          <p>
            We take security seriously. In practice that means: data encrypted in transit (TLS 1.2+)
            and at rest, passwords stored using industry-standard hashing, narrow access controls
            for our team, mandatory two-factor on production systems, and regular dependency and
            infrastructure updates. No system is bulletproof; if we detect a breach that affects
            your data we will notify you and the appropriate regulator within the timelines
            required by law.
          </p>

          <h2 id="children">9. Children's privacy</h2>
          <p>
            PupManager is not intended for children under 16. We don't knowingly collect personal
            data from children. If you believe a child has provided us personal data, contact{' '}
            <a href="mailto:info@pupmanager.com">info@pupmanager.com</a> and we'll delete it.
          </p>

          <h2 id="push-notifications">10. Push notifications</h2>
          <p>
            If you enable push notifications, we use Apple Push Notification service (iOS) or
            Firebase Cloud Messaging (Android) to deliver session reminders, homework alerts, and
            account messages. We send your device a token at registration and use it only to deliver
            notifications associated with your account. You can disable notifications at any time in
            your device settings or in the app's notification preferences.
          </p>

          <h2 id="international-transfers">11. International transfers</h2>
          <p>
            PupManager is operated from <strong>New Zealand</strong>. Our infrastructure providers
            (see §4) host data in the United States, the European Union, and other regions. Where
            your data is transferred internationally, those transfers are protected by contractual
            safeguards (such as Standard Contractual Clauses) where required by law.
          </p>

          <h2 id="changes">12. Changes to this policy</h2>
          <p>
            We'll update this page as the product evolves. The "Last updated" date at the top
            reflects the most recent change. For material changes, we'll notify active accounts by
            email at least 30 days before the change takes effect.
          </p>

          <h2 id="contact">13. Contact us</h2>
          <p>
            For privacy questions or to exercise any of the rights listed above:{' '}
            <a href="mailto:info@pupmanager.com">info@pupmanager.com</a>.
          </p>
          <p>
            For everything else: <a href="mailto:info@pupmanager.com">info@pupmanager.com</a>.
          </p>
        </article>

        <div className="mt-16 rounded-2xl border border-ink-100 bg-ink-50 p-6 text-sm text-ink-700">
          See also our <Link href="/terms" className="text-brand-700 hover:text-brand-800">Terms of Service</Link>.
        </div>
      </Container>
    </section>
  )
}

const toc = [
  { id: 'who-we-are', label: 'Who we are' },
  { id: 'what-we-collect', label: 'What we collect' },
  { id: 'how-we-use', label: 'How we use your information' },
  { id: 'who-we-share-with', label: 'Who we share information with' },
  { id: 'retention', label: 'How long we keep it' },
  { id: 'your-rights', label: 'Your rights' },
  { id: 'account-deletion', label: 'Deleting your account' },
  { id: 'security', label: 'Security' },
  { id: 'children', label: "Children's privacy" },
  { id: 'push-notifications', label: 'Push notifications' },
  { id: 'international-transfers', label: 'International transfers' },
  { id: 'changes', label: 'Changes to this policy' },
  { id: 'contact', label: 'Contact us' },
]

const subprocessors = [
  {
    name: 'Vercel',
    purpose: 'Hosting, deployment, analytics, file storage',
    region: 'United States, global edge',
  },
  {
    name: 'Supabase / Postgres',
    purpose: 'Primary database',
    region: 'Configured region',
  },
  {
    name: 'Resend',
    purpose: 'Transactional email (sign-in codes, receipts, reminders)',
    region: 'United States',
  },
  {
    name: 'Apple (APNs)',
    purpose: 'iOS push notification delivery',
    region: 'United States',
  },
  {
    name: 'Google (Firebase Cloud Messaging)',
    purpose: 'Android push notification delivery',
    region: 'United States',
  },
  {
    name: 'Stripe',
    purpose: 'Subscription billing and payment processing (when applicable)',
    region: 'United States, global',
  },
  {
    name: 'Anthropic',
    purpose: 'AI-assisted features (e.g. session note summarization). Inputs are not used to train models.',
    region: 'United States',
  },
]

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}
