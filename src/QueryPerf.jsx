import { useEffect, useState } from 'react'
import { api } from './api.js'

// pg_stat_statements columns. Numeric columns are right-aligned and client-sortable
// (the Neon console only sorts by avg time — here every column is a sort key).
const COLS = [
  { key: 'query', label: 'query', num: false },
  { key: 'calls', label: 'calls', num: true },
  { key: 'mean_exec_time', label: 'avg ms', num: true },
  { key: 'total_exec_time', label: 'total ms', num: true },
  { key: 'rows', label: 'rows', num: true },
]
const num = v => Number(v) || 0                                    // calls/rows arrive as bigint strings
const fmtN = v => num(v).toLocaleString()
const fmtMs = v => num(v).toLocaleString(undefined, { maximumFractionDigits: 1 })

export default function QueryPerf({ project, apiKey, projName }) {
  const [rows, setRows] = useState([])
  const [sorts, setSorts] = useState([
    { key: 'total_exec_time', dir: -1 },
    { key: 'calls', dir: -1 },
  ])   // dir: -1 desc, 1 asc
  const [status, setStatus] = useState('')
  const [err, setErr] = useState(false)

  useEffect(() => {
    if (!project || !apiKey) return
    let live = true
    setStatus('loading query stats…'); setErr(false)
    api('/query_perf?project_id=' + encodeURIComponent(project), apiKey)
      .then(j => { if (!live) return; const q = j.queries || []; setRows(q); setStatus(`${q.length} statements · ${j.database}`); setErr(false) })
      .catch(e => { if (!live) return; setRows([]); setStatus(e.message); setErr(true) })
    return () => { live = false }
  }, [project, apiKey, projName])

  const sorted = [...rows].sort((a, b) => {
    for (const sort of sorts) {
      const col = COLS.find(c => c.key === sort.key)
      const cmp = col.num
        ? num(a[sort.key]) - num(b[sort.key])
        : String(a[sort.key]).localeCompare(String(b[sort.key]))
      if (cmp) return cmp * sort.dir
    }
    return 0
  })

  const onSort = key => setSorts(current => {
    const idx = current.findIndex(s => s.key === key)
    const defaultSort = { key, dir: key === 'query' ? 1 : -1 }
    if (idx === 0) return [{ ...current[0], dir: -current[0].dir }, current[1]]
    if (idx === 1) return [current[1], current[0]]
    return [defaultSort, current[0]].slice(0, 2)
  })

  const sortMark = key => {
    const idx = sorts.findIndex(s => s.key === key)
    if (idx < 0) return ''
    return ` ${idx + 1}${sorts[idx].dir < 0 ? '▼' : '▲'}`
  }

  return (
    <div id="qperf">
      <div className="tsec">query performance · pg_stat_statements
        {status && <span className={'gnote' + (err ? '' : ' ok')}> {status}</span>}
      </div>
      {rows.length > 0 && (
        <table className="qtable">
          <thead>
            <tr>{COLS.map(c => (
              <th key={c.key} className={c.num ? 'n' : ''} onClick={() => onSort(c.key)}>
                {c.label}{sortMark(c.key)}
              </th>
            ))}</tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => (
              <tr key={r.queryid || i}>
                <td className="q" title={r.query}>{r.query}</td>
                <td className="n">{fmtN(r.calls)}</td>
                <td className="n">{fmtMs(r.mean_exec_time)}</td>
                <td className="n">{fmtMs(r.total_exec_time)}</td>
                <td className="n">{fmtN(r.rows)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
