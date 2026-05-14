import type { Metadata, Viewport } from 'next'
import { Geist } from 'next/font/google'
import localFont from 'next/font/local'
import './globals.css'
import { Nav } from '@/components/Nav'
import { Footer } from '@/components/Footer'
import { JsonLd } from '@/components/JsonLd'
import { RevealOnScroll } from '@/components/RevealOnScroll'
import { CookieBanner } from '@/components/CookieBanner'
import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { GoogleAnalytics } from '@next/third-parties/google'

const geist = Geist({ variable: '--font-geist', subsets: ['latin'] })

const balooBhai = localFont({
  src: './fonts/BalooBhai-Regular.ttf',
  variable: '--font-display',
  display: 'swap',
  weight: '400',
})

export const metadata: Metadata = {
  metadataBase: new URL('https://pupmanager.com'),
  title: {
    template: '%s · PupManager',
    default: 'PupManager — software for dog trainers',
  },
  description:
    'Scheduling, payments, structured progress, and a client app worth showing off. Built for solo and small-team dog trainers.',
  openGraph: {
    type: 'website',
    siteName: 'PupManager',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#2a9da9',
}

export const icons = {
  icon: '/icon-1024.png',
  apple: '/icon-1024.png',
}

const organizationSchema = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  '@id': 'https://pupmanager.com/#organization',
  name: 'PupManager',
  url: 'https://pupmanager.com',
  logo: 'https://pupmanager.com/icon-1024.png',
  email: 'info@pupmanager.com',
  description:
    'Software for working dog trainers — scheduling, structured progress, and a polished client app.',
  founder: {
    '@type': 'Person',
    '@id': 'https://pupmanager.com/#founder',
    name: 'Karl Friend',
    jobTitle: 'Founder',
    worksFor: { '@id': 'https://pupmanager.com/#organization' },
  },
  sameAs: [
    // TODO: add real social profiles as they go live
    // 'https://www.linkedin.com/company/pupmanager',
    // 'https://www.instagram.com/pupmanager',
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      suppressHydrationWarning
      className={`${geist.variable} ${balooBhai.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-white text-ink-900 flex flex-col">
        <JsonLd data={organizationSchema} />
        <RevealOnScroll />
        <Nav />
        <main className="flex-1">{children}</main>
        <Footer />
        <CookieBanner />
        <Analytics />
        <SpeedInsights />
        <GoogleAnalytics gaId="G-QFF3G5WGQ5" />
      </body>
    </html>
  )
}
