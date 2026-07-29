/** Tiny argument + prompt helpers. Shared by every script in scripts/import/. */
import { createInterface } from 'readline'

/** `--name value` or `--name=value`. Returns undefined when absent. */
export function arg(name: string, argv = process.argv.slice(2)): string | undefined {
  const eq = argv.find(a => a.startsWith(`--${name}=`))
  if (eq) return eq.slice(name.length + 3)
  const i = argv.indexOf(`--${name}`)
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1]
  return undefined
}

export function flag(name: string, argv = process.argv.slice(2)): boolean {
  return argv.includes(`--${name}`)
}

/** First non-flag argument — the positional a script takes (a folder, a path). */
export function positional(argv = process.argv.slice(2)): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      // Skip the value of `--name value` form.
      if (!a.includes('=') && argv[i + 1] && !argv[i + 1].startsWith('--')) i++
      continue
    }
    return a
  }
  return undefined
}

/**
 * Ask a question and return the typed answer.
 *
 * Refuses outright when stdin is not a terminal. A confirmation that can be
 * satisfied by a pipe is not a confirmation — and every write path in this
 * toolkit goes through one.
 */
export async function ask(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    console.error('\n✋ This step needs an interactive confirmation, and stdin is not a terminal.')
    console.error('   Run it yourself in a terminal — there is deliberately no flag to skip it.\n')
    process.exit(1)
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return await new Promise<string>(resolve => rl.question(question, a => resolve(a.trim())))
  } finally {
    rl.close()
  }
}

/** Require the operator to type an exact string (a database name, usually). */
export async function confirmExact(question: string, expected: string): Promise<void> {
  const answer = await ask(question)
  if (answer !== expected) {
    console.error(`\n✋ Stopped — expected "${expected}", got "${answer || '(nothing)'}". Nothing was written.\n`)
    process.exit(1)
  }
}

export function heading(text: string): void {
  console.log(`\n${'─'.repeat(72)}\n${text}\n${'─'.repeat(72)}`)
}

export function table(rows: Record<string, unknown>): void {
  const width = Math.max(...Object.keys(rows).map(k => k.length))
  for (const [k, v] of Object.entries(rows)) console.log(`  ${k.padEnd(width)}  ${v}`)
}
