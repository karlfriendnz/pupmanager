import type { Metadata, Viewport } from 'next'
import { Geist, Baloo_2 } from 'next/font/google'
import './globals.css'
import { NativeBootstrap } from '@/components/native/NativeBootstrap'

const geist = Geist({
  variable: '--font-geist',
  subsets: ['latin'],
})

// Baloo 2 — the body-text sibling of the PupManager wordmark (Baloo Bhai).
// Used as the display face for client-app headings to bring the brand's
// rounded, friendly character into the UI instead of the generic sans.
const baloo = Baloo_2({
  variable: '--font-baloo',
  subsets: ['latin'],
  weight: ['500', '600', '700', '800'],
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
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  themeColor: '#2563eb',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  // suppressHydrationWarning on both <html> and <body>: browser extensions
  // (Grammarly, ClickUp, AI assistants like Gemini/Claude) inject attributes
  // and classes onto these root elements before React hydrates. Suppressing
  // here only ignores attribute mismatches on this single element, not
  // children, so real bugs in our components still surface.
  return (
    <html lang="en-NZ" suppressHydrationWarning className={`${geist.variable} ${baloo.variable} h-full antialiased`}>
      <body suppressHydrationWarning className="min-h-full bg-slate-50 text-slate-900 flex flex-col">
        <NativeBootstrap />
        {children}
      </body>
    </html>
  )
}
