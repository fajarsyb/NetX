import { useEffect, useRef } from 'react'
import { Chart, ArcElement, Tooltip, Legend } from 'chart.js'
import { Doughnut } from 'react-chartjs-2'

Chart.register(ArcElement, Tooltip, Legend)

const COLORS = {
  networking: '#4f8ef7',
  endpoint:   '#10b981',
  printer:    '#f59e0b',
  phone:      '#a855f7',
  iot:        '#f97316',
  unknown:    '#475569',
}

const LABELS = {
  networking: '🖥 Networking',
  endpoint:   '💻 Endpoint',
  printer:    '🖨 Printer',
  phone:      '📱 Phone',
  iot:        '🔌 IoT',
  unknown:    '❓ Unknown',
}

export default function ArpDonutChart({ entries = [] }) {
  // Count by device category
  const counts = entries.reduce((acc, e) => {
    const cat = e.device_category || 'unknown'
    acc[cat] = (acc[cat] || 0) + 1
    return acc
  }, {})

  const cats = Object.keys(counts).filter(k => counts[k] > 0)

  if (cats.length === 0) return null

  const data = {
    labels: cats.map(c => LABELS[c] || c),
    datasets: [{
      data: cats.map(c => counts[c]),
      backgroundColor: cats.map(c => COLORS[c] || '#475569'),
      borderColor: '#111827',
      borderWidth: 3,
      hoverBorderWidth: 3,
      hoverOffset: 6,
    }],
  }

  const options = {
    cutout: '68%',
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'right',
        labels: {
          color: '#94a3b8',
          font: { family: 'Inter', size: 12, weight: '600' },
          padding: 14,
          boxWidth: 10,
          boxHeight: 10,
          borderRadius: 3,
        },
      },
      tooltip: {
        backgroundColor: '#1a2235',
        borderColor: '#1e2d45',
        borderWidth: 1,
        titleColor: '#f1f5f9',
        bodyColor: '#94a3b8',
        padding: 10,
        callbacks: {
          label: (ctx) => {
            const pct = ((ctx.raw / entries.length) * 100).toFixed(1)
            return `  ${ctx.raw} entri (${pct}%)`
          },
        },
      },
    },
  }

  return (
    <div style={{ height: '200px', position: 'relative' }}>
      <Doughnut data={data} options={options} />
    </div>
  )
}
