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

// ─── Phase 1: account + tax mapping options ───────────────────────────────────

export type XeroAccountOption = { code: string; name: string }
export type XeroTaxOption = { taxType: string; name: string }
export type XeroMappingOptions = {
  // Revenue accounts an invoice line can post to (the per-product + default
  // sales pickers). Bank accounts a client payment can be recorded against.
  revenueAccounts: XeroAccountOption[]
  bankAccounts: XeroAccountOption[]
  taxRates: XeroTaxOption[]
}

type RawAccount = { Code?: string; Name?: string; Type?: string; Class?: string; Status?: string }
type RawTaxRate = { Name?: string; TaxType?: string; Status?: string; CanApplyToRevenue?: boolean }

async function getJson<T>(connection: XeroConnection, path: string): Promise<T> {
  const res = await xeroFetch(connection, path)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Xero GET ${path} failed (${res.status}): ${text}`)
  }
  return res.json()
}

/**
 * Pull the connected org's chart of accounts + sales tax rates, shaped into the
 * pick-lists the mapping UI needs. Revenue accounts feed the per-product/default
 * income pickers; bank accounts feed the "where payments land" picker; tax rates
 * are limited to those that can apply to revenue (sales).
 */
export async function fetchMappingOptions(connection: XeroConnection): Promise<XeroMappingOptions> {
  const [accountsRes, taxRes] = await Promise.all([
    getJson<{ Accounts?: RawAccount[] }>(connection, '/Accounts'),
    getJson<{ TaxRates?: RawTaxRate[] }>(connection, '/TaxRates'),
  ])

  const accounts = accountsRes.Accounts ?? []
  const active = (a: RawAccount) => a.Status === 'ACTIVE' && !!a.Code && !!a.Name
  const byName = (a: XeroAccountOption, b: XeroAccountOption) => a.name.localeCompare(b.name)

  const revenueAccounts = accounts
    .filter((a) => active(a) && a.Class === 'REVENUE')
    .map((a) => ({ code: a.Code!, name: a.Name! }))
    .sort(byName)

  const bankAccounts = accounts
    .filter((a) => active(a) && a.Type === 'BANK')
    .map((a) => ({ code: a.Code!, name: a.Name! }))
    .sort(byName)

  const taxRates = (taxRes.TaxRates ?? [])
    .filter((t) => t.Status === 'ACTIVE' && t.CanApplyToRevenue && !!t.TaxType && !!t.Name)
    .map((t) => ({ taxType: t.TaxType!, name: t.Name! }))

  return { revenueAccounts, bankAccounts, taxRates }
}

// ─── Phase 2: contacts ────────────────────────────────────────────────────────

export type XeroContactInput = {
  name: string
  email?: string | null
  phone?: string | null
  // Skip the find/create round-trips entirely when we already know the id.
  existingContactId?: string | null
}

// Xero's `where` strings are doubled-quote delimited; strip any quotes from the
// value so a stray " can't break out of the filter.
function whereEquals(field: string, value: string): string {
  return `${field}=="${value.replace(/"/g, '')}"`
}

async function findContactId(connection: XeroConnection, where: string): Promise<string | null> {
  const res = await xeroFetch(connection, `/Contacts?where=${encodeURIComponent(where)}`)
  if (!res.ok) return null
  const data: { Contacts?: Array<{ ContactID?: string }> } = await res.json()
  return data.Contacts?.[0]?.ContactID ?? null
}

async function createContact(connection: XeroConnection, name: string, input: XeroContactInput): Promise<string | null> {
  const body = {
    Name: name,
    EmailAddress: input.email || undefined,
    Phones: input.phone ? [{ PhoneType: 'DEFAULT', PhoneNumber: input.phone }] : undefined,
  }
  const res = await xeroFetch(connection, '/Contacts', { method: 'POST', body: JSON.stringify(body) })
  if (!res.ok) return null
  const data: { Contacts?: Array<{ ContactID?: string }> } = await res.json()
  return data.Contacts?.[0]?.ContactID ?? null
}

/**
 * Find-or-create the Xero Contact for a client, returning its ContactID.
 *   1. Known id → use it.
 *   2. Match by email (the reliable key — Xero emails aren't unique but a hit is
 *      almost certainly the same person).
 *   3. Create. Xero enforces unique contact *names*, so on a name collision:
 *        - with an email → the colliding contact is a DIFFERENT person, so
 *          create under a disambiguated "Name (email)" rather than mis-linking;
 *        - without an email → reuse the existing same-named contact.
 */
export async function ensureXeroContact(connection: XeroConnection, input: XeroContactInput): Promise<string> {
  if (input.existingContactId) return input.existingContactId

  if (input.email) {
    const byEmail = await findContactId(connection, whereEquals('EmailAddress', input.email))
    if (byEmail) return byEmail
  }

  const created = await createContact(connection, input.name, input)
  if (created) return created

  // Create failed — almost always the unique-name constraint.
  if (input.email) {
    const disambiguated = await createContact(connection, `${input.name} (${input.email})`, input)
    if (disambiguated) return disambiguated
  } else {
    const byName = await findContactId(connection, whereEquals('Name', input.name))
    if (byName) return byName
  }

  throw new Error(`Xero contact ensure failed for "${input.name}"`)
}

// ─── Phase 3: invoices ────────────────────────────────────────────────────────

export type XeroInvoiceLine = {
  description: string
  quantity: number
  unitAmountMinor: number // cents — converted to Xero's major-unit decimal
  accountCode: string
  taxType?: string | null
}

export type XeroInvoiceInput = {
  contactId: string
  reference?: string | null
  // Whether a tax rate applies. Drives LineAmountTypes: our prices are
  // tax-INCLUSIVE, so an inclusive invoice total matches what the client pays
  // (important for the Phase 4 payment reconciliation). No tax → NoTax.
  hasTax: boolean
  lines: XeroInvoiceLine[]
}

/**
 * Create an AUTHORISED accounts-receivable (ACCREC) invoice in the trainer's
 * org and return its InvoiceID. AUTHORISED (not DRAFT) so Phase 4 can apply a
 * payment against it.
 */
export async function createXeroInvoice(connection: XeroConnection, input: XeroInvoiceInput): Promise<string> {
  const body = {
    Type: 'ACCREC',
    Contact: { ContactID: input.contactId },
    Status: 'AUTHORISED',
    LineAmountTypes: input.hasTax ? 'Inclusive' : 'NoTax',
    Reference: input.reference || undefined,
    LineItems: input.lines.map((l) => ({
      Description: l.description,
      Quantity: l.quantity,
      UnitAmount: Number((l.unitAmountMinor / 100).toFixed(2)),
      AccountCode: l.accountCode,
      ...(input.hasTax ? { TaxType: l.taxType || undefined } : {}),
    })),
  }
  const res = await xeroFetch(connection, '/Invoices', { method: 'POST', body: JSON.stringify(body) })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Xero invoice create failed (${res.status}): ${text}`)
  }
  const data: { Invoices?: Array<{ InvoiceID?: string }> } = await res.json()
  const id = data.Invoices?.[0]?.InvoiceID
  if (!id) throw new Error('Xero invoice create returned no InvoiceID')
  return id
}

// ─── Phase 4: payments ────────────────────────────────────────────────────────

export type XeroPaymentInput = {
  invoiceId: string
  accountCode: string // the bank account the payment is recorded against
  amountMinor: number // cents — converted to Xero's major-unit decimal
  date: Date
  reference?: string | null
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * Apply a payment against an existing invoice, recording it into the given bank
 * account, and return the Xero PaymentID. Marks the invoice PAID in Xero.
 */
export async function createXeroPayment(connection: XeroConnection, input: XeroPaymentInput): Promise<string> {
  const body = {
    Invoice: { InvoiceID: input.invoiceId },
    Account: { Code: input.accountCode },
    Amount: Number((input.amountMinor / 100).toFixed(2)),
    Date: ymd(input.date),
    Reference: input.reference || undefined,
  }
  const res = await xeroFetch(connection, '/Payments', { method: 'PUT', body: JSON.stringify(body) })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Xero payment create failed (${res.status}): ${text}`)
  }
  const data: { Payments?: Array<{ PaymentID?: string }> } = await res.json()
  const id = data.Payments?.[0]?.PaymentID
  if (!id) throw new Error('Xero payment create returned no PaymentID')
  return id
}
