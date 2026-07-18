// A lightweight Flesch–Kincaid grade-level estimate, used to nudge announcement
// copy toward plain, easy-to-read (K–12) language. Approximate by design — it
// counts syllables with a vowel-group heuristic, which is close enough to steer
// wording without pulling in a dictionary.

function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '')
  if (!w) return 0
  if (w.length <= 3) return 1
  const groups = w
    .replace(/e\b/, '') // silent trailing e
    .match(/[aeiouy]+/g)
  return Math.max(1, groups ? groups.length : 1)
}

export interface Readability {
  grade: number // Flesch–Kincaid grade level (rounded to 1dp)
  words: number
  sentences: number
}

export function readability(text: string): Readability {
  const clean = text.trim()
  if (!clean) return { grade: 0, words: 0, sentences: 0 }

  const words = clean.split(/\s+/).filter(Boolean)
  // Count sentence-enders; a block with no ./!/? still counts as one sentence.
  const sentences = Math.max(1, (clean.match(/[.!?]+(\s|$)/g) || []).length)
  const syllables = words.reduce((n, w) => n + countSyllables(w), 0)

  const grade = 0.39 * (words.length / sentences) + 11.8 * (syllables / words.length) - 15.59
  return {
    grade: Math.round(Math.max(0, grade) * 10) / 10,
    words: words.length,
    sentences,
  }
}

// A friendly, non-numeric read on how easy the copy is. Target for user-facing
// announcements is roughly grade 8 or below.
export function readingEase(grade: number): { label: string; tone: 'good' | 'ok' | 'hard' } {
  if (grade <= 8) return { label: 'Easy to read', tone: 'good' }
  if (grade <= 11) return { label: 'A bit hard — try shorter words', tone: 'ok' }
  return { label: 'Hard to read — shorten sentences and words', tone: 'hard' }
}
