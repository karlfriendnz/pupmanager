'use client'

import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', loading, disabled, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pm-brand-500)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
          {
            // Brand teal (pm-brand tokens) — the app-wide primary button colour.
            'bg-[var(--pm-brand-600)] text-white hover:bg-[var(--pm-brand-700)] active:bg-[var(--pm-brand-700)]': variant === 'primary',
            'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 active:bg-slate-100': variant === 'secondary',
            'text-slate-600 hover:bg-slate-100 active:bg-slate-200': variant === 'ghost',
            'bg-red-600 text-white hover:bg-red-700 active:bg-red-800': variant === 'danger',
          },
          {
            'h-9 px-3 text-sm': size === 'sm',
            'h-11 px-5 text-sm': size === 'md',
            'h-14 px-6 text-base': size === 'lg',
          },
          className
        )}
        {...props}
      >
        {loading && (
          <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )}
        {children}
      </button>
    )
  }
)

Button.displayName = 'Button'
export { Button }
