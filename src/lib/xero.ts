import type { XeroConnection } from '@/generated/prisma'
import { prisma } from '@/lib/prisma'
import { env } from '@/lib/env'

// Xero OAuth2 + API client. PupManager is a confidential (server-side) client:
// each trainer connects their OWN Xero organisation, and their invoices/
// payments/contacts sync into that org. Tokens live on XeroConnection (one row
// per connected trainer). The refresh token ROTATES on every refresh, so every
// refresh persists the new one or the connection silently dies.

const AUTHORIZE_URL = 'https://login.xero.com/identity/connect/authorize'
const TOKEN_URL = 'https://identity.xero.com/connect/token'
const CONNECTIONS_URL = 'https://api.xero.com/connections'
export const XERO_API_BASE = 'https://api.xero.com/api.xro/2.0'

// offline_access → refresh token; accounting.transactions → invoices + payments;
// accounting.contacts → contacts; accounting.settings.read → chart of accounts +
// tax rates (read-only, for the Phase 1 mapping picker).
const SCOPES = [
  'offline_access',
  'accounting.transactions',
  'accounting.contacts',
  'accounting.settings.read',
].join(' ')

// Refresh a little before the real 30-minute expiry so an in-flight request
// never races the cutoff.
const EXPIRY_SKEW_MS = 60 * 1000

export function isXeroConfigured(): boolean {
  return !!env.XERO_CLIENT_ID && !!env.XERO_CLIENT_SECRET
}

export function xeroRedirectUri(): string {
  return `${env.NEXT_PUBLIC_APP_URL}/api/xero/callback`
}

/** The Xero consent URL to redirect the trainer to, carrying our CSRF state. */
export function xeroAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: env.XERO_CLIENT_ID!,
    redirect_uri: xeroRedirectUri(),
    scope: SCOPES,
    state,
  })
  return `${AUTHORIZE_URL}?${params}`
}

// Xero accepts the client credentials as HTTP Basic auth on the token endpoint.
function basicAuthHeader(): string {
  const creds = `${env.XERO_CLIENT_ID}:${env.XERO_CLIENT_SECRET}`
  return `Basic ${Buffer.from(creds).toString('base64')}`
}

type TokenResponse = {
  access_token: string
  refresh_token: string
  expires_in: number
}

async function postToken(body: URLSearchParams): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Xero token request failed (${res.status}): ${text}`)
  }
  return res.json()
}

/** Exchange the authorization code from the callback for the initial tokens. */
export function exchangeCodeForTokens(code: string): Promise<TokenResponse> {
  return postToken(
    new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: xeroRedirectUri(),
    }),
  )
}

type XeroTenant = { tenantId: string; tenantName: string }

/**
 * After the token exchange, ask Xero which organisations this auth can reach and
 * return the first real ORGANISATION (vs PRACTICE) tenant — the org we'll sync to.
 */
export async function fetchPrimaryTenant(accessToken: string): Promise<XeroTenant | null> {
  const res = await fetch(CONNECTIONS_URL, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  })
  if (!res.ok) return null
  const conns: Array<{ tenantId: string; tenantName?: string; tenantType?: string }> = await res.json()
  const org = conns.find((c) => c.tenantType === 'ORGANISATION') ?? conns[0]
  if (!org) return null
  return { tenantId: org.tenantId, tenantName: org.tenantName ?? '' }
}

function expiryFrom(expiresInSeconds: number): Date {
  return new Date(Date.now() + expiresInSeconds * 1000 - EXPIRY_SKEW_MS)
}

/**
 * Return a usable access token for this connection, refreshing (and persisting
 * the rotated refresh token + new access token) when the cached one is stale.
 * Throws if the refresh fails — the caller decides whether to surface or swallow.
 */
export async function getValidAccessToken(connection: XeroConnection): Promise<string> {
  const fresh =
    connection.accessToken &&
    connection.accessTokenExpiresAt &&
    connection.accessTokenExpiresAt.getTime() > Date.now()
  if (fresh) return connection.accessToken!

  const tokens = await postToken(
    new URLSearchParams({ grant_type: 'refresh_token', refresh_token: connection.refreshToken }),
  )

  await prisma.xeroConnection.update({
    where: { id: connection.id },
    data: {
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token,
      accessTokenExpiresAt: expiryFrom(tokens.expires_in),
    },
  })

  return tokens.access_token
}

/**
 * Authenticated call against the Xero Accounting API for a connection. Handles
 * the access-token refresh and the required tenant header. `path` is relative to
 * the 2.0 base (e.g. "/Contacts"). Returns the raw Response so callers handle
 * status codes themselves.
 */
export async function xeroFetch(
  connection: XeroConnection,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const accessToken = await getValidAccessToken(connection)
  return fetch(`${XERO_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Xero-tenant-id': connection.tenantId,
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  })
}
