import type { Metadata, Viewport } from 'next'
import { Geist } from 'next/font/google'
import './globals.css'
import { Nav } from '@/components/Nav'
import { Footer } from '@/components/Footer'

const geist = Geist({ variable: '--font-geist', subsets: ['latin'] })

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} h-full antialiased`}>
      <body className="min-h-full bg-white text-ink-900 flex flex-col">
        <Nav />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  )
}
