import { useEffect, useMemo, useRef } from 'react'
import {
  Chart as ChartJS, LineController, LineElement, PointElement,
  LinearScale, TimeScale, Filler, Tooltip, Legend,
} from 'chart.js'
import 'chartjs-adapter-date-fns'
import zoomPlugin from 'chartjs-plugin-zoom'
import { Line } from 'react-chartjs-2'
import { bucketPoints, rawTotal } from './metrics.js'

ChartJS.register(LineController, LineElement, PointElement, LinearScale, TimeScale, Filler, Tooltip, Legend, zoomPlugin)

function chartOptions(m) {
  return {
    responsive: true, maintainAspectRatio: false, animation: false, parsing: false,
    interaction: { mode: 'index', intersect: false },
    scales: {
      x: { type: 'time', time: { tooltipFormat: 'yyyy-MM-dd HH:mm' }, grid: { color: '#161b22' }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 8, color: '#6e7681' } },
      y: { grid: { color: '#21262d' }, ticks: { color: '#6e7681', callback: v => (+v).toFixed(m.dp) }, beginAtZero: true },
    },
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: c => c.parsed.y.toFixed(m.dp) + ' ' + m.unit } },
      zoom: { zoom: { drag: { enabled: true, backgroundColor: 'rgba(88,166,255,.15)', borderColor: '#58a6ff', borderWidth: 1 }, mode: 'x' }, pan: { enabled: false } },
    },
  }
}

function bigSummary(m, points, total, isCum) {
  const avg = points.length ? total / points.length : 0
  const last = points.at(-1)?.y ?? 0
  const peak = points.reduce((a, d) => Math.max(a, d.y), 0)
  const f = n => n.toFixed(m.dp)
  if (isCum) return <>{f(last)} <small>{m.unit} cumulative total</small></>
  if (m.total) return <>{f(total)} <small>{m.unit} total · {f(avg)} avg/bucket · last {f(last)}</small></>
  if (m.peak) return <>{f(avg)} <small>{m.unit} avg · peak {f(peak)} · last {f(last)}</small></>
  return <>{f(last)} <small>{m.unit} last · {f(avg)} avg</small></>
}

export default function MetricChart({ m, rows, span, cumulative, onToggleCum, fullscreen, onToggleFull, loading, resetNonce }) {
  const ref = useRef(null)
  const isCum = !!(m.cumulative && cumulative)
  const points = useMemo(() => bucketPoints(rows, m, span, isCum), [rows, m, span, isCum])
  const total = useMemo(() => rawTotal(rows, m, span), [rows, m, span])
  const data = useMemo(() => ({
    datasets: [{ label: m.unit, data: points, borderColor: m.color, backgroundColor: m.color + '22', fill: true, tension: 0.25, pointRadius: 0, borderWidth: 1.5 }],
  }), [points, m])
  const options = useMemo(() => chartOptions(m), [m])

  // Reset zoom across all charts when the toolbar button bumps the nonce.
  useEffect(() => { if (resetNonce) ref.current?.resetZoom?.() }, [resetNonce])

  const showSkeleton = loading && !rows.length

  return (
    <div className={'card' + (fullscreen ? ' fullscreen' : '')}>
      <div className="card-head">
        <h2>{m.title}</h2>
        <div className="chart-actions">
          {m.cumulative && (
            <button type="button" className={'cum' + (isCum ? ' on' : '')} aria-pressed={isCum} onClick={onToggleCum}>cumulative</button>
          )}
          <button type="button" className={'full' + (fullscreen ? ' on' : '')} aria-pressed={fullscreen} onClick={onToggleFull}>{fullscreen ? 'X' : 'fullscreen'}</button>
        </div>
      </div>
      <div className="sub">{m.sub}</div>
      <div className="big">{rows.length ? bigSummary(m, points, total, isCum) : '–'}</div>
      <div className="chart-wrap">
        {showSkeleton ? <div className="skeleton" /> : <Line ref={ref} data={data} options={options} />}
      </div>
    </div>
  )
}
