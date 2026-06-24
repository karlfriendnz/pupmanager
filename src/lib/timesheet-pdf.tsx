import { Document, Page, View, Text, StyleSheet, renderToBuffer } from '@react-pdf/renderer'
import { money, minutesToHours } from '@/lib/timesheets'

// Server-only: renders a finalised timesheet to a PDF Buffer for emailing or
// download. Do NOT import from client components.

export type PdfEntry = {
  date: Date | string
  task: string
  minutes: number
  rateName: string | null
  amountCents: number
  clientName: string | null
  category: string | null
}

export type TimesheetPdfData = {
  businessName: string
  staffName: string
  weekStart: Date | string
  title: string | null
  notes: string | null
  currency: string
  entries: PdfEntry[]
  finalisedAt: Date | string | null
}

const ACCENT = '#0d9488'

const s = StyleSheet.create({
  page: { padding: 36, fontSize: 9, color: '#0f172a', fontFamily: 'Helvetica' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 },
  business: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: '#0f172a' },
  badge: { fontSize: 8, color: '#ffffff', backgroundColor: ACCENT, paddingVertical: 3, paddingHorizontal: 8, borderRadius: 4, fontFamily: 'Helvetica-Bold' },
  sub: { fontSize: 9, color: '#475569', marginTop: 2 },
  rule: { borderBottomWidth: 2, borderBottomColor: ACCENT, marginTop: 10, marginBottom: 12 },
  th: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#cbd5e1', paddingBottom: 5, marginBottom: 2 },
  tr: { flexDirection: 'row', paddingVertical: 5, borderBottomWidth: 0.5, borderBottomColor: '#e2e8f0' },
  thText: { fontFamily: 'Helvetica-Bold', color: '#64748b', fontSize: 8, textTransform: 'uppercase' },
  cDate: { width: '12%' },
  cTask: { width: '34%' },
  cClient: { width: '16%' },
  cRate: { width: '16%' },
  cHours: { width: '10%', textAlign: 'right' },
  cAmount: { width: '12%', textAlign: 'right' },
  muted: { color: '#94a3b8' },
  totalsBox: { marginTop: 14, alignSelf: 'flex-end', width: '50%' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  grand: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 6, marginTop: 4, borderTopWidth: 1, borderTopColor: '#cbd5e1' },
  grandText: { fontFamily: 'Helvetica-Bold', fontSize: 11 },
  sectionTitle: { fontFamily: 'Helvetica-Bold', fontSize: 9, color: '#64748b', textTransform: 'uppercase', marginTop: 16, marginBottom: 4 },
  notes: { color: '#475569', lineHeight: 1.4 },
  footer: { position: 'absolute', bottom: 24, left: 36, right: 36, fontSize: 8, color: '#94a3b8', textAlign: 'center' },
})

function fmtDate(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d
  return date.toLocaleDateString('en-NZ', { day: '2-digit', month: 'short', timeZone: 'UTC' })
}
function fmtFull(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d
  return date.toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}

function TimesheetDoc({ data }: { data: TimesheetPdfData }) {
  const weekStart = new Date(data.weekStart)
  const weekEnd = new Date(weekStart); weekEnd.setUTCDate(weekEnd.getUTCDate() + 6)
  const totalMinutes = data.entries.reduce((n, e) => n + e.minutes, 0)
  const totalCents = data.entries.reduce((n, e) => n + e.amountCents, 0)

  // Subtotals grouped by rate name (or "Unrated").
  const byRate = new Map<string, { minutes: number; cents: number }>()
  for (const e of data.entries) {
    const key = e.rateName ?? 'Unrated'
    const cur = byRate.get(key) ?? { minutes: 0, cents: 0 }
    cur.minutes += e.minutes; cur.cents += e.amountCents
    byRate.set(key, cur)
  }

  return (
    <Document>
      <Page size="A4" style={s.page}>
        <View style={s.headerRow}>
          <View>
            <Text style={s.business}>{data.businessName}</Text>
            <Text style={s.sub}>Timesheet · {data.staffName}</Text>
          </View>
          <Text style={s.badge}>{data.finalisedAt ? 'FINALISED' : 'DRAFT'}</Text>
        </View>
        <Text style={s.sub}>
          Week of {fmtFull(weekStart)} – {fmtFull(weekEnd)}{data.title ? ` · ${data.title}` : ''}
        </Text>
        <View style={s.rule} />

        <View style={s.th}>
          <Text style={[s.thText, s.cDate]}>Date</Text>
          <Text style={[s.thText, s.cTask]}>Task</Text>
          <Text style={[s.thText, s.cClient]}>Client</Text>
          <Text style={[s.thText, s.cRate]}>Rate</Text>
          <Text style={[s.thText, s.cHours]}>Hours</Text>
          <Text style={[s.thText, s.cAmount]}>Amount</Text>
        </View>

        {data.entries.length === 0 && <Text style={[s.muted, { paddingVertical: 8 }]}>No entries.</Text>}
        {data.entries.map((e, i) => (
          <View style={s.tr} key={i} wrap={false}>
            <Text style={s.cDate}>{fmtDate(e.date)}</Text>
            <View style={s.cTask}>
              <Text>{e.task}</Text>
              {e.category ? <Text style={s.muted}>{e.category}</Text> : null}
            </View>
            <Text style={s.cClient}>{e.clientName ?? '—'}</Text>
            <Text style={s.cRate}>{e.rateName ?? '—'}</Text>
            <Text style={s.cHours}>{minutesToHours(e.minutes).toFixed(2)}</Text>
            <Text style={s.cAmount}>{money(e.amountCents, data.currency)}</Text>
          </View>
        ))}

        <View style={s.totalsBox}>
          {[...byRate.entries()].map(([name, v]) => (
            <View style={s.totalRow} key={name}>
              <Text style={s.muted}>{name} · {minutesToHours(v.minutes).toFixed(2)}h</Text>
              <Text>{money(v.cents, data.currency)}</Text>
            </View>
          ))}
          <View style={s.grand}>
            <Text style={s.grandText}>Total · {minutesToHours(totalMinutes).toFixed(2)}h</Text>
            <Text style={s.grandText}>{money(totalCents, data.currency)}</Text>
          </View>
        </View>

        {data.notes ? (
          <View>
            <Text style={s.sectionTitle}>Notes</Text>
            <Text style={s.notes}>{data.notes}</Text>
          </View>
        ) : null}

        <Text style={s.footer} fixed>
          {data.businessName} · Generated by PupManager{data.finalisedAt ? ` · Finalised ${fmtFull(data.finalisedAt)}` : ''}
        </Text>
      </Page>
    </Document>
  )
}

export async function renderTimesheetPdf(data: TimesheetPdfData): Promise<Buffer> {
  return renderToBuffer(<TimesheetDoc data={data} />)
}
