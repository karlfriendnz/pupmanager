import { describe, it, expect } from 'vitest'
import { buildEmbed } from '@/app/(trainer)/lead-magnets/lead-magnets-manager'

const URL = 'https://app.pupmanager.com/c/demo-dog-training/free/5-tips-for-the-calm-puppy'

describe('buildEmbed', () => {
  it('appends the Powered by PupManager credit by default', () => {
    const html = buildEmbed(URL)
    expect(html).toContain(`<iframe src="${URL}?embed=1"`)
    expect(html).toContain('Powered by')
    expect(html).toContain('https://pupmanager.com')
  })

  it('appends the credit when branding is explicitly "powered"', () => {
    const html = buildEmbed(URL, 'powered')
    expect(html).toContain('Powered by')
    expect(html).toContain('<p')
  })

  it('omits the credit line entirely when branding is "none"', () => {
    const html = buildEmbed(URL, 'none')
    expect(html).toContain(`<iframe src="${URL}?embed=1"`)
    expect(html).not.toContain('Powered by')
    expect(html).not.toContain('https://pupmanager.com')
    expect(html).not.toContain('<p')
  })

  it('produces a single iframe element and no trailing credit for "none"', () => {
    const html = buildEmbed(URL, 'none')
    expect(html.trim()).toBe(`<iframe src="${URL}?embed=1" width="100%" height="520" style="border:0;max-width:480px" title="Free download"></iframe>`)
  })
})
