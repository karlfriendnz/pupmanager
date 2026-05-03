import type { Metadata, Viewport } from 'next'
import { Geist } from 'next/font/google'
import './globals.css'

const geist = Geist({
  variable: '--font-geist',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: {
    template: '%s | PupManager',
    default: 'PupManager — Dog Training Made Simple',
  },
  description: 'Assign daily training tasks, track compliance, and keep your clients on track between sessions.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'PupManager',
    startupImage: '/apple-icon',
  },
  icons: {
    apple: '/apple-icon',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#2563eb',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en-NZ" className={`${geist.variable} h-full antialiased`}>
      {/* suppressHydrationWarning on body: some browser extensions (e.g. ClickUp,
          Grammarly) inject classes onto <body> before React hydrates. Without this,
          every page logs a benign hydration mismatch. */}
      <body suppressHydrationWarning className="min-h-full bg-slate-50 text-slate-900 flex flex-col">
        {children}
      </body>
    </html>
  )
}
