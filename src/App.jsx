import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api.js'
import { METRICS, METRICS_V2, SNAP, rowsFrom, flattenV2 } from './metrics.js'
import MetricChart from './MetricChart.jsx'
import QueryPerf from './QueryPerf.jsx'

const KEY_LS = 'neon_api_key'
const isoDay = d => d.toISOString().slice(0, 10)

export default function App() {
  const [key, setKey] = useState(() => localStorage.getItem(KEY_LS) || '')
  const [orgs, setOrgs] = useState([])
  const [org, setOrg] = useState('')
  const [projects, setProjects] = useState([])               // [{id, name}]
  const [project, setProject] = useState('')                 // '' = all projects
  const [from, setFrom] = useState(() => isoDay(new Date(Date.now() - 40 * 864e5)))
  const [to, setTo] = useState(() => isoDay(new Date()))
  const [gran, setGran] = useState('daily')
  const [poll, setPoll] = useState(false)

  const [v1Rows, setV1Rows] = useState([])
  const [v2Rows, setV2Rows] = useState([])
  const [v2Error, setV2Error] = useState('')
  const [snap, setSnap] = useState(null)                     // {p, bs} | {err} | null
  const [cumulative, setCumulative] = useState({})           // metric id -> bool
  const [fullscreenId, setFullscreenId] = useState(null)
  const [resetNonce, setResetNonce] = useState(0)
  const [activeTab, setActiveTab] = useState('usage')

  const [status, setStatus] = useState('enter API key →')
  const [statusErr, setStatusErr] = useState(false)
  const [loading, setLoading] = useState(false)

  const projName = id => projects.find(p => p.id === id)?.name || id
  const span = gran === 'hourly' ? 3600 : 86400

  const loadProjects = useCallback(async (orgId, k) => {
    const j = await api('/projects?org_id=' + encodeURIComponent(orgId), k)
    const ps = (j.projects || []).map(p => ({ id: p.id, name: p.name || p.id }))
    setProjects(ps)
    return ps
  }, [])

  // `over` carries fresher-than-state values from change handlers (avoids React state-timing races).
  const load = useCallback(async (over = {}) => {
    const _key = over.key ?? key
    const _org = over.org ?? org
    const _projects = over.projects ?? projects
    const _project = over.project ?? project
    const _gran = over.gran ?? gran
    if (!_org) return
    setLoading(true)
    try {
      const q = new URLSearchParams({ org_id: _org, from: from + 'T00:00:00Z', to: to + 'T23:59:59Z', granularity: _gran })
      if (_project) q.set('project_ids', _project)
      else if (_projects.length) q.set('project_ids', _projects.map(p => p.id).join(','))
      const qv = new URLSearchParams(q)
      qv.set('metrics', METRICS_V2.map(m => m.key).join(','))   // v2 requires an explicit metrics list

      const [j, j2] = await Promise.all([
        api('/consumption?' + q.toString(), _key),
        api('/consumption_v2?' + qv.toString(), _key).catch(e => ({ __err: e.message })),   // v2 only on usage-based plans
      ])

      const rows = rowsFrom(j)
      if (!rows.length) { setV1Rows([]); setStatus('no data in range'); setStatusErr(true); return }
      setV1Rows(rows)

      if (j2.__err) { setV2Rows([]); setV2Error(j2.__err) }
      else { setV2Rows(rowsFrom(flattenV2(j2))); setV2Error('') }

      if (_project) {
        try {
          const [pd, br] = await Promise.all([
            api('/project?project_id=' + encodeURIComponent(_project), _key),
            api('/branches?project_id=' + encodeURIComponent(_project), _key),
          ])
          setSnap({ p: pd.project, bs: br.branches || [] })
        } catch { setSnap({ err: true }) }
      } else setSnap(null)

      setStatus(`loaded ${rows.length} buckets · ${_project ? projName(_project) : 'all projects'}${poll ? ' · live' : ''} · drag chart to zoom`)
      setStatusErr(false)
    } catch (e) {
      setStatus(e.message); setStatusErr(true)
    } finally {
      setLoading(false)
    }
  }, [key, org, projects, project, gran, from, to, poll])   // eslint-disable-line react-hooks/exhaustive-deps

  const refreshOrgProjects = useCallback(async (k) => {
    const j = await api('/orgs', k)
    const os = j.organizations || []
    setOrgs(os)
    const first = os[0]?.id || ''
    setOrg(first)
    const ps = first ? await loadProjects(first, k) : []
    return { first, ps }
  }, [loadProjects])

  // Initial load if a key is already saved.
  const didInit = useRef(false)
  useEffect(() => {
    if (didInit.current || !key) return
    didInit.current = true
    refreshOrgProjects(key)
      .then(({ first, ps }) => first && load({ key, org: first, projects: ps }))
      .catch(e => { setStatus(e.message); setStatusErr(true) })
  }, [key, refreshOrgProjects, load])

  // Live polling.
  useEffect(() => {
    if (!poll) return
    load()
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [poll, load])

  function onKeyCommit() {
    const v = key.trim()
    if (!v) return
    localStorage.setItem(KEY_LS, v)
    refreshOrgProjects(v)
      .then(({ first, ps }) => first && load({ key: v, org: first, projects: ps }))
      .catch(e => { setStatus(e.message); setStatusErr(true) })
  }

  async function onOrgChange(o) {
    setOrg(o); setProject('')
    const ps = await loadProjects(o, key)
    load({ org: o, projects: ps, project: '' })
  }
  function onProjectChange(p) { setProject(p); load({ project: p }) }
  function onGranChange(g) { setGran(g); load({ gran: g }) }

  function forget() {
    localStorage.removeItem(KEY_LS)
    setKey(''); setPoll(false); setOrgs([]); setProjects([])
    setV1Rows([]); setV2Rows([]); setStatus('key forgotten'); setStatusErr(false)
  }

  function toggleCum(id) { setCumulative(c => ({ ...c, [id]: !c[id] })) }

  function toggleFull(id) { setFullscreenId(cur => (cur === id ? null : id)) }

  // Lock body scroll while any chart is fullscreen.
  useEffect(() => {
    document.body.classList.toggle('full-chart', fullscreenId != null)
    return () => document.body.classList.remove('full-chart')
  }, [fullscreenId])

  const chartProps = m => ({
    m, span, loading, resetNonce,
    cumulative: !!cumulative[m.id],
    onToggleCum: () => toggleCum(m.id),
    fullscreen: fullscreenId === m.id,
    onToggleFull: () => toggleFull(m.id),
  })

  return (
    <>
      <header>
        <span className={'dot' + (poll ? '' : ' off')} />
        <h1>Neon usage — consumption_history v1 + v2</h1>
        {loading && <span className="spinner" aria-label="loading" />}
      </header>

      <form onSubmit={e => { e.preventDefault(); load() }}>
        <label>API key (napi_…)
          <input type="password" size={30} placeholder="napi_..." autoComplete="off"
            value={key} onChange={e => setKey(e.target.value)} onBlur={onKeyCommit}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onKeyCommit() } }} />
        </label>
        <label>Org
          <select value={org} onChange={e => onOrgChange(e.target.value)}>
            {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>
        <label>Project
          <select value={project} onChange={e => onProjectChange(e.target.value)}>
            <option value="">all projects</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label>From<input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
        <label>To<input type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
        <label>Granularity
          <select value={gran} onChange={e => onGranChange(e.target.value)}>
            <option value="hourly">hourly</option>
            <option value="daily">daily</option>
          </select>
        </label>
        <button type="submit">Load</button>
        <label className="chk"><input type="checkbox" checked={poll} onChange={e => setPoll(e.target.checked)} />Live 5s</label>
        <button type="button" className="ghost" onClick={() => setResetNonce(n => n + 1)}>Reset zoom</button>
        <button type="button" className="ghost" onClick={forget}>Forget key</button>
      </form>

      <div id="status" className={statusErr ? 'err' : ''}>{status}</div>

      <div className="tabs" role="tablist" aria-label="dashboard sections">
        <button type="button" role="tab" aria-selected={activeTab === 'usage'} className={activeTab === 'usage' ? 'on' : ''} onClick={() => setActiveTab('usage')}>Usage</button>
        <button type="button" role="tab" aria-selected={activeTab === 'queries'} className={activeTab === 'queries' ? 'on' : ''} onClick={() => setActiveTab('queries')}>Query performance</button>
      </div>

      {activeTab === 'usage' ? (
        <>
          <div id="totals">
            {!project ? (
              <div className="hint">select a project to see transfer / DB-size / storage totals (current billing period — not in consumption_history)</div>
            ) : snap?.err ? (
              <div className="hint">totals unavailable</div>
            ) : snap ? (
              <>
                <div className="tsec">project totals · current billing period</div>
                <div className="tcards">
                  {SNAP.map(s => {
                    const v = s.src === 'branches' ? s.val(snap.bs) : s.val(snap.p)
                    return <div className="tcard" key={s.id}><div className="tlabel">{s.title}</div><div className="tval">{s.fmt(v)}</div></div>
                  })}
                </div>
              </>
            ) : null}
          </div>

          <div id="grid">
            <div className="gsec">consumption_history · v1 (CPU &amp; activity)</div>
            {METRICS.map(m => <MetricChart key={m.id} {...chartProps(m)} rows={v1Rows} />)}
            <div className="gsec">
              consumption_history · v2 (billing-aligned)
              {v2Error && <span className="gnote">v2 unavailable: {v2Error}</span>}
            </div>
            {METRICS_V2.map(m => <MetricChart key={m.id} {...chartProps(m)} rows={v2Rows} />)}
          </div>
        </>
      ) : (
        <div className="tab-panel">
          {project ? (
            <QueryPerf project={project} apiKey={key} projName={projName(project)} />
          ) : (
            <div className="hint">select a project to see query performance</div>
          )}
        </div>
      )}
    </>
  )
}
