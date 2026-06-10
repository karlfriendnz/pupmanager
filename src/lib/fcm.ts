import { createSign } from 'node:crypto'
import { env } from '@/lib/env'

// Firebase Cloud Messaging — Android push via the HTTP v1 API, authenticated
// with the Firebase service account (OAuth2 JWT bearer, same idea as the APNs
// .p8 JWT in apns.ts). Entirely no-op when FCM_SERVICE_ACCOUNT is unset, so
// the app runs fine without Android push configured.

interface ServiceAccount { projectId: string; clientEmail: string; privateKey: string }

interface FcmPayload {
  alert: { title: string; body: string }
  customData?: Record<string, unknown>
}

export interface FcmResult { token: string; ok: boolean; status?: number; reason?: string }

// FCM error statuses that mean the token is dead — caller should delete the row.
export const FCM_INVALID_TOKEN_REASONS = new Set(['UNREGISTERED', 'INVALID_ARGUMENT', 'NOT_FOUND'])

// undefined = not parsed yet, null = unconfigured/invalid.
let cachedAccount: ServiceAccount | null | undefined

function getAccount(): ServiceAccount | null {
  if (cachedAccount !== undefined) return cachedAccount
  const raw = env.FCM_SERVICE_ACCOUNT
  if (!raw) { cachedAccount = null; return null }
  try {
    const o = JSON.parse(raw)
    // Vercel single-line env strips real newlines from the PEM; restore them.
    const privateKey = String(o.private_key ?? '').replace(/\\n/g, '\n')
    cachedAccount = o.project_id && o.client_email && privateKey
      ? { projectId: o.project_id, clientEmail: o.client_email, privateKey }
      : null
  } catch {
    cachedAccount = null
  }
  return cachedAccount
}

export function isFcmConfigured(): boolean { return getAccount() != null }

let cachedToken: { token: string; expiresAt: number } | null = null

async function getAccessToken(acct: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  if (cachedToken && cachedToken.expiresAt > now + 60) return cachedToken.token

  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const signingInput =
    `${b64({ alg: 'RS256', typ: 'JWT' })}.` +
    b64({
      iss: acct.clientEmail,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })
  const signer = createSign('RSA-SHA256')
  signer.update(signingInput)
  const assertion = `${signingInput}.${signer.sign(acct.privateKey).toString('base64url')}`

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })
  if (!res.ok) throw new Error(`FCM token exchange failed: ${res.status}`)
  const json = await res.json()
  cachedToken = { token: json.access_token, expiresAt: now + (json.expires_in ?? 3600) }
  return cachedToken.token
}

export async function sendFcm(deviceTokens: string[], payload: FcmPayload): Promise<FcmResult[]> {
  if (deviceTokens.length === 0) return []
  const acct = getAccount()
  if (!acct) return [] // Android push not configured — silently skip.

  let accessToken: string
  try {
    accessToken = await getAccessToken(acct)
  } catch {
    return deviceTokens.map(t => ({ token: t, ok: false }))
  }

  const url = `https://fcm.googleapis.com/v1/projects/${acct.projectId}/messages:send`
  // FCM `data` values must all be strings.
  const data = payload.customData
    ? Object.fromEntries(Object.entries(payload.customData).map(([k, v]) => [k, String(v)]))
    : undefined

  return Promise.all(deviceTokens.map(async (token): Promise<FcmResult> => {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: payload.alert.title, body: payload.alert.body },
            ...(data ? { data } : {}),
            android: { priority: 'high', notification: { sound: 'default' } },
          },
        }),
      })
      if (res.ok) return { token, ok: true, status: res.status }
      let reason: string | undefined
      try {
        const j = await res.json()
        reason = j?.error?.details?.find?.((d: { errorCode?: string }) => d.errorCode)?.errorCode ?? j?.error?.status
      } catch { /* ignore */ }
      return { token, ok: false, status: res.status, reason }
    } catch {
      return { token, ok: false }
    }
  }))
}
