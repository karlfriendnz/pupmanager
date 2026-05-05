import { connect, type ClientHttp2Session } from 'node:http2'
import { createSign } from 'node:crypto'

// Apple Push Notification service — token-based JWT auth (.p8 key).
// Docs: https://developer.apple.com/documentation/usernotifications/sending_notification_requests_to_apns

const APNS_HOST = 'api.push.apple.com' // production (TestFlight + App Store)

interface ApnsConfig {
  keyId: string
  teamId: string
  bundleId: string
  privateKeyPem: string
}

interface ApnsPayload {
  alert: { title: string; body: string }
  sound?: string
  badge?: number
  customData?: Record<string, unknown>
}

interface SendResult {
  token: string
  ok: boolean
  status?: number
  reason?: string
}

function getConfig(): ApnsConfig {
  const keyId = process.env.APNS_KEY_ID
  const teamId = process.env.APNS_TEAM_ID
  const bundleId = process.env.APNS_BUNDLE_ID
  const privateKeyPem = process.env.APNS_PRIVATE_KEY

  if (!keyId || !teamId || !bundleId || !privateKeyPem) {
    throw new Error('APNS env vars missing — set APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID, APNS_PRIVATE_KEY')
  }
  // Vercel env vars don't preserve real newlines in single-line input, so we
  // accept the .p8 with literal "\n" sequences and restore them here.
  return { keyId, teamId, bundleId, privateKeyPem: privateKeyPem.replace(/\\n/g, '\n') }
}

let cachedJwt: { token: string; expiresAt: number } | null = null

function makeJwt(cfg: ApnsConfig): string {
  // Apple requires the JWT to be refreshed at least every hour and at most
  // every 20 minutes. Cache for 50 minutes to stay comfortably inside the window.
  const now = Math.floor(Date.now() / 1000)
  if (cachedJwt && cachedJwt.expiresAt > now + 60) return cachedJwt.token

  const header = { alg: 'ES256', kid: cfg.keyId }
  const payload = { iss: cfg.teamId, iat: now }

  const b64url = (obj: object) =>
    Buffer.from(JSON.stringify(obj)).toString('base64url')

  const signingInput = `${b64url(header)}.${b64url(payload)}`
  const signer = createSign('SHA256')
  signer.update(signingInput)
  const signature = signer.sign({ key: cfg.privateKeyPem, dsaEncoding: 'ieee-p1363' }).toString('base64url')

  const jwt = `${signingInput}.${signature}`
  cachedJwt = { token: jwt, expiresAt: now + 50 * 60 }
  return jwt
}

async function sendOne(
  client: ClientHttp2Session,
  cfg: ApnsConfig,
  jwt: string,
  deviceToken: string,
  payload: ApnsPayload,
): Promise<SendResult> {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      aps: {
        alert: payload.alert,
        sound: payload.sound ?? 'default',
        ...(payload.badge !== undefined ? { badge: payload.badge } : {}),
      },
      ...(payload.customData ?? {}),
    })

    const req = client.request({
      ':method': 'POST',
      ':path': `/3/device/${deviceToken}`,
      'authorization': `bearer ${jwt}`,
      'apns-topic': cfg.bundleId,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body).toString(),
    })

    let status = 0
    let responseBody = ''
    req.on('response', (headers) => { status = Number(headers[':status']) })
    req.on('data', (chunk) => { responseBody += chunk.toString() })
    req.on('end', () => {
      if (status === 200) {
        resolve({ token: deviceToken, ok: true, status })
      } else {
        let reason: string | undefined
        try { reason = JSON.parse(responseBody)?.reason } catch { /* ignore */ }
        resolve({ token: deviceToken, ok: false, status, reason })
      }
    })
    req.on('error', () => resolve({ token: deviceToken, ok: false }))
    req.end(body)
  })
}

export async function sendApns(
  deviceTokens: string[],
  payload: ApnsPayload,
): Promise<SendResult[]> {
  if (deviceTokens.length === 0) return []
  const cfg = getConfig()
  const jwt = makeJwt(cfg)
  const client = connect(`https://${APNS_HOST}`)

  try {
    return await Promise.all(deviceTokens.map((t) => sendOne(client, cfg, jwt, t, payload)))
  } finally {
    client.close()
  }
}

// APNs returns these error reasons when a token is no longer valid; the caller
// should delete the corresponding row so we stop retrying forever.
export const INVALID_TOKEN_REASONS = new Set([
  'BadDeviceToken',
  'Unregistered',
  'DeviceTokenNotForTopic',
])
