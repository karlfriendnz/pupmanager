import { ImageResponse } from 'next/og'

export const alt = 'PupManager — software for dog trainers'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function OG() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '64px',
          background: 'linear-gradient(135deg, #effcfd 0%, #ffffff 50%, #d4f5f8 100%)',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div
            style={{
              fontSize: 56,
              fontWeight: 700,
              color: '#4799a3',
              letterSpacing: '-0.02em',
            }}
          >
            PupManager
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div
            style={{
              fontSize: 76,
              fontWeight: 600,
              color: '#0f1f24',
              letterSpacing: '-0.03em',
              lineHeight: 1.05,
              maxWidth: 980,
            }}
          >
            You're great at training dogs.
          </div>
          <div
            style={{
              fontSize: 48,
              color: '#5b7682',
              letterSpacing: '-0.02em',
              lineHeight: 1.1,
            }}
          >
            More time with the dogs. Less time with the laptop.
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            color: '#5b7682',
            fontSize: 24,
          }}
        >
          <span>pupmanager.com</span>
          <span style={{ color: '#4799a3' }}>For dog trainers</span>
        </div>
      </div>
    ),
    { ...size },
  )
}
