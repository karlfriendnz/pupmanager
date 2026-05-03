import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Sign in',
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-12 bg-gradient-to-b from-blue-50 to-white">
      <div className="mb-8 flex flex-col items-center gap-2">
        {/* Logo mark */}
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 text-white text-2xl shadow-lg">
          🐾
        </div>
        <span className="text-xl font-bold text-slate-900 tracking-tight">PupManager</span>
      </div>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  )
}
