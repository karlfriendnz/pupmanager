import { describe, it, expect } from 'vitest'
import { collectClientFieldWrites, hasClientFieldWrites } from '@/lib/client-field-writes'
import { createClientFieldQuestion, type Question } from '@/lib/session-form-builder'
import { CLIENT_FIELDS } from '@/lib/client-fields'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// "The system fields are just a result of the forms" (Karl, 2026-07-30). So a form
// can ask for the built-in details as questions — and those answers have to land on
// the REAL columns, not in the form's answer blob. A name collected on an intake
// form has to BE the client's name, or the trainer's list still says "Unnamed"
// after the client filled it in.

const q = (key: string, id: string) => createClientFieldQuestion(key, id) as Question

// A value each detail will actually accept — a weight that isn't a number and a
// birthday that isn't a date are dropped, and would skip the column check.
const sampleFor = (key: string) =>
  key === 'dogWeight' ? '18.5' : key === 'dogDob' ? '2024-03-01' : 'something'

// Read the columns straight out of schema.prisma rather than the generated client:
// no runtime to load, and it fails the moment a column is renamed in the schema.
const SCHEMA = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8')
function columnsOf(model: string): string[] {
  const block = new RegExp(`^model ${model} \\{$([\\s\\S]*?)^\\}$`, 'm').exec(SCHEMA)
  if (!block) throw new Error(`model ${model} not found in schema.prisma`)
  return block[1]
    .split('\n')
    .map(l => /^\s{2}(\w+)\s+\S/.exec(l)?.[1])
    .filter((n): n is string => !!n)
}

describe('where each detail is written', () => {
  it('sends each one to the record it belongs to', () => {
    const questions = [q('name', 'a'), q('phone', 'b'), q('dogBreed', 'c')]
    const w = collectClientFieldWrites(questions, { a: 'Sarah Scott', b: '021 555 0101', c: 'Groodle' })
    expect(w.user).toEqual({ name: 'Sarah Scott' })
    expect(w.profile).toEqual({ phone: '021 555 0101' })
    expect(w.dog).toEqual({ breed: 'Groodle' })
  })

  it('writes an address to addressLine, the column that actually exists', () => {
    // ClientProfile has addressLine (+ lat/lng/placeId), never `address`. Sending
    // `address` throws at Prisma, so the intake submit 500s and the client is
    // returned to the same gate with no way past it.
    const w = collectClientFieldWrites([q('address', 'a')], { a: '12 Queen St' })
    expect(w.profile).toEqual({ addressLine: '12 Queen St' })
  })

  it('every column it writes to is a real column on that model', () => {
    // The guard that would have caught the address bug: ask each built-in detail
    // for a write, then check the column against the schema itself.
    for (const field of CLIENT_FIELDS) {
      const w = collectClientFieldWrites([q(field.key, 'a')], { a: sampleFor(field.key) })
      for (const column of Object.keys(w.user)) expect(columnsOf('User')).toContain(column)
      for (const column of Object.keys(w.profile)) expect(columnsOf('ClientProfile')).toContain(column)
      for (const column of Object.keys(w.dog)) expect(columnsOf('Dog')).toContain(column)
    }
  })

  it('ignores ordinary questions entirely', () => {
    const questions: Question[] = [
      { id: 'a', type: 'SHORT_TEXT', label: 'Anything else?', required: false },
      { id: 'b', type: 'CUSTOM_FIELD', customFieldId: 'f1', required: false },
    ]
    expect(hasClientFieldWrites(collectClientFieldWrites(questions, { a: 'hello', b: 'x' }))).toBe(false)
  })
})

describe('a blank answer never clears what is already there', () => {
  // The one that would quietly destroy data: a client skipping an optional
  // question must not wipe the phone number their trainer typed in.
  it('writes nothing for an empty, whitespace or missing answer', () => {
    const questions = [q('phone', 'a'), q('address', 'b'), q('dogNotes', 'c')]
    const w = collectClientFieldWrites(questions, { a: '', b: '   ', c: undefined })
    expect(hasClientFieldWrites(w)).toBe(false)
  })

  it('still writes the answers that WERE given', () => {
    const w = collectClientFieldWrites([q('name', 'a'), q('phone', 'b')], { a: 'Tom', b: '' })
    expect(w.user).toEqual({ name: 'Tom' })
    expect(w.profile).toEqual({})
  })
})

describe('the dog’s details get their real column types', () => {
  // Prisma rejects a string where it wants a Float or a DateTime, so a weight and
  // a birthday can't be passed straight through.
  it('turns a weight into a number', () => {
    const w = collectClientFieldWrites([q('dogWeight', 'a')], { a: '18.5' })
    expect(w.dog.weight).toBe(18.5)
  })

  it('refuses a weight that isn’t one', () => {
    for (const bad of ['heavy', '0', '-4', '']) {
      expect(collectClientFieldWrites([q('dogWeight', 'a')], { a: bad }).dog.weight, bad).toBeUndefined()
    }
  })

  // The bug this avoids: `new Date('2022-03-14')` in a timezone behind UTC lands on
  // the 13th, so a dog's birthday slips a day every time the form is submitted.
  it('keeps a birthday on its own date', () => {
    const w = collectClientFieldWrites([q('dogDob', 'a')], { a: '2022-03-14' })
    expect((w.dog.dob as Date).toISOString()).toBe('2022-03-14T00:00:00.000Z')
  })

  it('ignores a birthday that isn’t a date', () => {
    expect(collectClientFieldWrites([q('dogDob', 'a')], { a: 'last spring' }).dog.dob).toBeUndefined()
  })
})

describe('answers that arrive as a list', () => {
  it('joins them into the one text column', () => {
    const w = collectClientFieldWrites([q('dogNotes', 'a')], { a: ['Pulls on lead', 'Barks at bikes'] })
    expect(w.dog.notes).toBe('Pulls on lead, Barks at bikes')
  })

  it('treats an empty list as no answer', () => {
    expect(hasClientFieldWrites(collectClientFieldWrites([q('dogNotes', 'a')], { a: [] }))).toBe(false)
  })
})

describe('a key we don’t recognise', () => {
  // A form authored against a key that has since been renamed or removed. Skipping
  // it is right; guessing a column from the string would be a write into the dark.
  it('is skipped rather than guessed at', () => {
    const w = collectClientFieldWrites([q('not_a_field', 'a')], { a: 'something' })
    expect(hasClientFieldWrites(w)).toBe(false)
  })
})
