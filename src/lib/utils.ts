import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: Date | string): string {
  return new Intl.DateTimeFormat('en-NZ', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(date))
}

export function formatTime(date: Date | string): string {
  return new Intl.DateTimeFormat('en-NZ', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(date))
}

// Strip the redundant "— session 1/1" suffix from package-generated session
// titles. Earlier package assignments wrote that suffix unconditionally; the
// API now omits it for single-session packages, but legacy rows still carry
// it. Multi-session forms ("— session 2/3") are preserved so the trainer can
// see progression at a glance.
//
// Two variants get stripped:
//   • "— session 1/1" (legacy single-session counter)
//   • "— session" (bare suffix with no counter at all — also adds no info)
// "— session 2/3" and higher are kept because the count is meaningful.
export function formatSessionTitle(title: string): string {
  return title.replace(/\s*[—-]\s*session(\s+1\s*\/\s*1)?\s*$/i, '')
}

export function getInitials(name: string): string {
  return name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}
