import { describe, it, expect } from 'vitest'
import { personaliseWelcomeNote } from '@/lib/welcome-note'

describe('personaliseWelcomeNote', () => {
  it('puts the first name where the placeholder is', () => {
    expect(personaliseWelcomeNote('<p>Hi {{name}}, welcome!</p>', 'Karl'))
      .toBe('<p>Hi Karl, welcome!</p>')
  })

  it('replaces every occurrence, not just the first', () => {
    expect(personaliseWelcomeNote('<p>{{name}}</p><p>See you {{name}}</p>', 'Sam'))
      .toBe('<p>Sam</p><p>See you Sam</p>')
  })

  // A trainer typing the placeholder by hand shouldn't have to match it exactly.
  it('forgives spacing and case', () => {
    expect(personaliseWelcomeNote('<p>{{ Name }} and {{NAME}}</p>', 'Jo'))
      .toBe('<p>Jo and Jo</p>')
  })

  it('leaves a note without the placeholder alone', () => {
    expect(personaliseWelcomeNote('<p>Welcome along.</p>', 'Karl'))
      .toBe('<p>Welcome along.</p>')
  })

  // The name comes from the client's own profile, which they can edit, and the
  // note is HTML by the time this runs. Without escaping, one client renames
  // themselves and writes markup into a page every client of that trainer sees.
  it('escapes the name rather than trusting it', () => {
    expect(personaliseWelcomeNote('<p>Hi {{name}}</p>', '<script>alert(1)</script>'))
      .toBe('<p>Hi &lt;script&gt;alert(1)&lt;/script&gt;</p>')
  })

  it('escapes ampersands and quotes in an ordinary name', () => {
    expect(personaliseWelcomeNote('<p>Hi {{name}}</p>', 'Ben & "Bo"'))
      .toBe('<p>Hi Ben &amp; &quot;Bo&quot;</p>')
  })

  // "Hi {{name}}" printed raw is worse than "Hi".
  it('drops the placeholder when there is no name', () => {
    expect(personaliseWelcomeNote('<p>Hi {{name}}</p>', null)).toBe('<p>Hi </p>')
    expect(personaliseWelcomeNote('<p>Hi {{name}}</p>', '   ')).toBe('<p>Hi </p>')
  })

  it('treats an empty note as empty', () => {
    expect(personaliseWelcomeNote(null, 'Karl')).toBe('')
    expect(personaliseWelcomeNote(undefined, 'Karl')).toBe('')
    expect(personaliseWelcomeNote('', 'Karl')).toBe('')
  })
})
