import { ImageResponse } from 'next/og'

export const runtime = 'edge'
export const alt = 'Tages | Persistent codebase memory for AI agents'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          height: '100%',
          backgroundColor: '#0a0a0a',
          color: 'white',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', fontSize: 72, fontWeight: 700, color: '#3BA3C7' }}>
          Tages
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: 28,
            color: '#a1a1aa',
            marginTop: 16,
            maxWidth: 600,
            textAlign: 'center',
          }}
        >
          Persistent codebase memory for AI coding agents
        </div>
        <div style={{ display: 'flex', fontSize: 18, color: '#52525b', marginTop: 32 }}>
          tages.ai
        </div>
      </div>
    ),
    { ...size },
  )
}
