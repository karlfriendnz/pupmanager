'use client'

// Thin themed wrappers over react-chartjs-2. Chart.js is tree-shaken, so every
// element/scale/plugin used anywhere here must be registered once below.
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  ArcElement,
  Tooltip,
  Legend,
  Filler,
  type ChartOptions,
} from 'chart.js'
import { Bar, Line, Doughnut } from 'react-chartjs-2'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, PointElement, LineElement,
  ArcElement, Tooltip, Legend, Filler,
)

// Teal-led categorical palette (matches the app accent), reused across charts.
export const PALETTE = [
  '#0d9488', '#f59e0b', '#8b5cf6', '#3b82f6', '#f43f5e',
  '#10b981', '#6366f1', '#ec4899', '#14b8a6', '#eab308',
]
const ACCENT = '#0d9488'

const GRID = '#f1f5f9'
const TICK = '#94a3b8'

function baseScales(currency?: string): ChartOptions<'bar' | 'line'>['scales'] {
  return {
    x: { grid: { display: false }, ticks: { color: TICK, font: { size: 11 } } },
    y: {
      beginAtZero: true,
      grid: { color: GRID },
      ticks: {
        color: TICK,
        font: { size: 11 },
        precision: 0,
        callback: currency
          ? (v) => formatAxisMoney(Number(v), currency)
          : undefined,
      },
    },
  }
}

function formatAxisMoney(cents: number, currency: string): string {
  const sym = currency.toUpperCase() === 'USD' ? '$' : currency.toUpperCase() === 'GBP' ? '£' : currency.toUpperCase() === 'EUR' ? '€' : '$'
  return `${sym}${Math.round(cents / 100)}`
}

export function BarChart({
  labels, data, label, color = ACCENT, horizontal = false,
}: {
  labels: string[]
  data: number[]
  label: string
  color?: string
  horizontal?: boolean
}) {
  return (
    <div className="h-64">
      <Bar
        data={{ labels, datasets: [{ label, data, backgroundColor: color, borderRadius: 6, maxBarThickness: 48 }] }}
        options={{
          indexAxis: horizontal ? 'y' : 'x',
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: baseScales(),
        }}
      />
    </div>
  )
}

export function LineChart({
  labels, data, label, currency,
}: {
  labels: string[]
  data: number[]
  label: string
  currency?: string
}) {
  return (
    <div className="h-64">
      <Line
        data={{
          labels,
          datasets: [{
            label, data,
            borderColor: ACCENT,
            backgroundColor: 'rgba(13,148,136,0.12)',
            fill: true, tension: 0.35, pointRadius: 3, pointBackgroundColor: ACCENT,
          }],
        }}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: currency ? {
              callbacks: { label: (c) => formatAxisMoney(Number(c.raw), currency) },
            } : undefined,
          },
          scales: baseScales(currency),
        }}
      />
    </div>
  )
}

export function DoughnutChart({
  labels, data,
}: {
  labels: string[]
  data: number[]
}) {
  return (
    <div className="h-64">
      <Doughnut
        data={{ labels, datasets: [{ data, backgroundColor: PALETTE, borderWidth: 0 }] }}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          cutout: '62%',
          plugins: {
            legend: { position: 'right', labels: { color: '#475569', font: { size: 12 }, boxWidth: 12, padding: 12 } },
          },
        }}
      />
    </div>
  )
}
