// Vercel edge function: serves the dashboard HTML and proxies Neon API calls.
// (Neon API sends no CORS headers, so the browser can't call it directly.)
// Shared with local dev — neon-cpu-chart.mjs imports this handler into Bun.serve.
//
// NOTE: the public API key exposes ONLY consumption_history (4 metrics, hourly):
//   compute_time_seconds, active_time_seconds, written_data_bytes, synthetic_storage_size_bytes.
export const config = { runtime: 'edge' }

const NEON = 'https://console.neon.tech/api/v2'

async function neon(path, key) {
  const r = await fetch(NEON + path, {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }
  })
  return new Response(await r.text(), { status: r.status, headers: { 'Content-Type': 'application/json' } })
}

const HTML = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Neon usage</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@3.0.0/dist/chartjs-adapter-date-fns.bundle.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-zoom@2.0.1/dist/chartjs-plugin-zoom.min.js"></script>
<style>
  :root { color-scheme: dark }
  * { box-sizing: border-box }
  body { font: 13px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; margin: 0; background:#0d1117; color:#e6edf3 }
  header { padding: 14px 20px; border-bottom: 1px solid #21262d; display:flex; align-items:center; gap:14px }
  h1 { font-size: 14px; margin: 0; font-weight: 600 }
  .dot { width:7px;height:7px;border-radius:50%;background:#3fb950;display:inline-block;box-shadow:0 0 6px #3fb950 }
  .dot.off { background:#6e7681; box-shadow:none }
  form { display: flex; flex-wrap: wrap; gap: 10px; align-items: end; padding: 14px 20px; border-bottom: 1px solid #21262d }
  label { display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: #8b949e }
  input, select, button { font: inherit; background:#161b22; color:#e6edf3; border:1px solid #30363d; border-radius:6px; padding:6px 8px }
  input:focus, select:focus { outline: none; border-color:#58a6ff }
  button { cursor: pointer; background:#238636; border-color:#2ea043; color:#fff; font-weight:600 }
  button:hover { filter:brightness(1.1) }
  button.ghost { background:#21262d; border-color:#30363d; color:#e6edf3; font-weight:400 }
  label.chk { flex-direction:row; align-items:center; gap:6px; font-size:12px; color:#e6edf3 }
  label.chk input { width:auto }
  #status { padding: 8px 20px; color:#8b949e; min-height: 16px; border-bottom:1px solid #21262d }
  #status.err { color:#f85149 }
  #grid { display:grid; grid-template-columns:repeat(2,1fr); gap:14px; padding:16px 20px }
  .card { border:1px solid #21262d; border-radius:10px; padding:12px 14px; background:#0f141a }
  .card-head { display:flex; align-items:center; gap:10px; margin-bottom:2px }
  .card h2 { font-size:12px; margin:0; font-weight:600 }
  .cum { margin-left:auto; padding:3px 7px; border-radius:999px; background:#21262d; border-color:#30363d; color:#8b949e; font-size:11px; font-weight:600 }
  .cum.on { background:#238636; border-color:#2ea043; color:#fff }
  .card .sub { font-size:11px; color:#8b949e; margin-bottom:8px }
  .card .big { font-size:18px; font-weight:600 }
  .card .big small { font-size:11px; color:#8b949e; font-weight:400; margin-left:6px }
  canvas { width:100% !important }
  a { color:#58a6ff }
  #totals { padding:14px 20px 0 }
  #totals .hint { color:#6e7681; font-size:12px }
  .tsec { font-size:11px; color:#8b949e; margin-bottom:8px; text-transform:uppercase; letter-spacing:.04em }
  .tcards { display:grid; grid-template-columns:repeat(5,1fr); gap:10px }
  .tcard { border:1px solid #21262d; border-radius:8px; padding:10px 12px; background:#0f141a }
  .tcard .tlabel { font-size:11px; color:#8b949e; margin-bottom:4px }
  .tcard .tval { font-size:16px; font-weight:600 }
  @media (max-width:900px){ #grid{ grid-template-columns:1fr } .tcards{ grid-template-columns:repeat(2,1fr) } }
</style>
</head>
<body>
<header><span id="live" class="dot off"></span><h1>Neon usage — consumption_history</h1></header>
<form id="f">
  <label>API key (napi_…)<input id="key" type="password" size="30" placeholder="napi_..." autocomplete="off"/></label>
  <label>Org<select id="org"></select></label>
  <label>Project<select id="project"></select></label>
  <label>From<input id="from" type="date"/></label>
  <label>To<input id="to" type="date"/></label>
  <label>Granularity<select id="gran"><option>hourly</option><option selected>daily</option></select></label>
  <button type="submit">Load</button>
  <label class="chk"><input id="poll" type="checkbox"/>Live 5s</label>
  <button type="button" id="reset" class="ghost">Reset zoom</button>
  <button type="button" id="forget" class="ghost">Forget key</button>
</form>
<div id="status">enter API key →</div>
<div id="totals"></div>
<div id="grid"></div>

<script>
const $ = s => document.querySelector(s)
const KEY_LS = 'neon_api_key'
let charts = {}, pollTimer = null, busy = false
let cumulative = { cpuhours:false, active:false, written:false }
let projNames = {}                                   // project_id -> display name (filled by loadProjects)

const METRICS = [
  { id:'cores',   title:'CPU used', sub:'avg cores = compute_time_seconds / bucket (set granularity=hourly for finer curve)', color:'#58a6ff',
    val:(r,span)=>r.compute_time_seconds/span, unit:'cores', dp:2, peak:true },
  { id:'cpuhours', title:'CPU usage hours', sub:'compute-hours = compute_time_seconds / 3600 (CPU usage, not utilization)', color:'#388bfd',
    val:r=>r.compute_time_seconds/3600, unit:'compute-hrs', dp:1, total:true, cumulative:true },
  { id:'active',  title:'Active endpoint time', sub:'active_time_seconds / 3600 (wall time computes ran, NOT CPU-weighted)', color:'#3fb950',
    val:r=>r.active_time_seconds/3600, unit:'endpoint-hrs', dp:1, total:true, cumulative:true },
  { id:'written', title:'Data written',  sub:'written_data_bytes / 1e6',                  color:'#d29922',
    val:r=>r.written_data_bytes/1e6, unit:'MB', dp:1, total:true, cumulative:true },
  { id:'storage', title:'Storage size',  sub:'synthetic_storage_size_bytes / 1e9 (snapshot, not summed)', color:'#bc8cff',
    val:r=>r.synthetic_storage_size_bytes/1e9, unit:'GB', dp:2, total:false },
]

// Current-billing-period totals the consumption_history series does NOT expose.
// Sourced from the project-detail / branches endpoints, so they are point-in-time
// snapshots (refreshed every load/poll), not time series.
const SNAP = [
  { id:'transfer', title:'Data transfer (egress)', src:'project',  val:p=>p.data_transfer_bytes,     fmt:bytes },
  { id:'dbsize',   title:'DB size (logical)',       src:'branches', val:bs=>bs.reduce((a,b)=>a+(b.logical_size||0),0), fmt:bytes },
  { id:'storehr',  title:'Data storage',            src:'project',  val:p=>p.data_storage_bytes_hour, fmt:v=>(v/1e9).toFixed(2)+' GB·hr' },
  { id:'cpu',      title:'CPU used',                src:'project',  val:p=>p.cpu_used_sec/3600,       fmt:v=>v.toFixed(1)+' compute-hrs' },
  { id:'synth',    title:'Storage (current)',       src:'project',  val:p=>p.synthetic_storage_size,  fmt:bytes },
]

function bytes(b){ if(b==null) return '–'; const u=['B','KB','MB','GB','TB']; let i=0,v=b; while(v>=1024&&i<u.length-1){v/=1024;i++} return v.toFixed(v<10&&i>0?2:1)+' '+u[i] }
function setStatus(m, err){ const s=$('#status'); s.textContent=m; s.className=err?'err':'' }
function spanSec(){ return $('#gran').value==='hourly' ? 3600 : 86400 }

async function loadTotals(){
  const proj = $('#project').value
  const box = $('#totals')
  if(!proj){ box.innerHTML = '<div class="hint">select a project to see transfer / DB-size / storage totals (current billing period — not in consumption_history)</div>'; return }
  try{
    const [pd, br] = await Promise.all([ api('/project?project_id='+encodeURIComponent(proj)), api('/branches?project_id='+encodeURIComponent(proj)) ])
    const p = pd.project, bs = br.branches || []
    box.innerHTML = '<div class="tsec">project totals · current billing period</div><div class="tcards">' +
      SNAP.map(m=>{ const v = m.src==='branches' ? m.val(bs) : m.val(p)
        return '<div class="tcard"><div class="tlabel">'+m.title+'</div><div class="tval">'+m.fmt(v)+'</div></div>' }).join('') +
      '</div>'
  }catch(e){ box.innerHTML = '<div class="hint">totals unavailable: '+e.message+'</div>' }
}

async function api(path){
  const key = $('#key').value.trim()
  if(!key) throw new Error('enter API key')
  const r = await fetch('/api'+path, { headers:{'x-neon-key':key} })
  const j = await r.json()
  if(!r.ok) throw new Error(j.message || ('HTTP '+r.status))
  return j
}

async function loadOrgs(){
  const j = await api('/orgs')
  const orgs = j.organizations || []
  $('#org').innerHTML = orgs.map(o=>'<option value="'+o.id+'">'+o.name+'</option>').join('')
  return orgs
}
async function loadProjects(orgId){
  const j = await api('/projects?org_id='+encodeURIComponent(orgId))
  const ps = j.projects || []
  ps.forEach(p=>{ projNames[p.id] = p.name || p.id })
  $('#project').innerHTML = '<option value="">all projects</option>' +
    ps.map(p=>'<option value="'+p.id+'">'+(p.name||p.id)+'</option>').join('')
  return ps
}

function buildGrid(){
  $('#grid').innerHTML = METRICS.map(m=>
    '<div class="card"><div class="card-head"><h2>'+m.title+'</h2>'+
    (m.cumulative ? '<button type="button" class="cum" data-cum="'+m.id+'" aria-pressed="false">cumulative</button>' : '')+
    '</div><div class="sub">'+m.sub+'</div>'+
    '<div class="big" id="big-'+m.id+'">–</div>'+
    '<canvas id="cv-'+m.id+'" height="150"></canvas></div>'
  ).join('')
  for(const m of METRICS){
    charts[m.id] = new Chart($('#cv-'+m.id), {
      type:'line',
      data:{ datasets:[{ label:m.unit, data:[], borderColor:m.color, backgroundColor:m.color+'22',
        fill:true, tension:.25, pointRadius:0, borderWidth:1.5 }] },
      options:{
        responsive:true, animation:false, parsing:false,
        interaction:{mode:'index',intersect:false},
        scales:{
          x:{ type:'time', time:{ tooltipFormat:'yyyy-MM-dd HH:mm' }, grid:{color:'#161b22'}, ticks:{maxRotation:0,autoSkip:true,maxTicksLimit:8,color:'#6e7681'} },
          y:{ grid:{color:'#21262d'}, ticks:{color:'#6e7681',callback:v=>(+v).toFixed(m.dp)}, beginAtZero:true }
        },
        plugins:{
          legend:{display:false},
          tooltip:{ callbacks:{ label:c=>{ const n=c.dataset.label; return (n&&n!==m.unit?n+': ':'')+c.parsed.y.toFixed(m.dp)+' '+m.unit } } },
          zoom:{ zoom:{ drag:{enabled:true,backgroundColor:'rgba(88,166,255,.15)',borderColor:'#58a6ff',borderWidth:1}, mode:'x' }, pan:{enabled:false} }
        }
      }
    })
    charts[m.id].$metric = m
  }
  document.querySelectorAll('[data-cum]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const id = btn.dataset.cum
      cumulative[id] = !cumulative[id]
      btn.classList.toggle('on', cumulative[id])
      btn.setAttribute('aria-pressed', cumulative[id] ? 'true' : 'false')
      tick()
    })
  })
}

function rowsFrom(j){
  return (j.projects||[]).flatMap(p=>(p.periods||[]).flatMap(pe=>pe.consumption||[]))
    .sort((a,b)=>a.timeframe_start.localeCompare(b.timeframe_start))
}

function bucketPoints(rows,m,span,accumulate){
  const buckets = new Map()
  for(const r of rows){
    const t = r.timeframe_start
    buckets.set(t, (buckets.get(t)||0) + m.val(r,span))
  }
  let acc = 0
  return [...buckets.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([t,y])=>({
    x:new Date(t).getTime(),
    y:accumulate ? (acc+=y) : y
  }))
}

function renderBig(m,ch){
  const data = ch.data.datasets[0]?.data || []
  const isCumulative = m.cumulative && cumulative[m.id]
  const rawTotal = ch.$rawTotal || 0
  const avg = data.length ? rawTotal/data.length : 0
  const last = data[data.length-1]?.y ?? 0
  const peak = data.reduce((a,d)=>Math.max(a,d.y),0)
  $('#big-'+m.id).innerHTML = isCumulative
    ? last.toFixed(m.dp)+' <small>'+m.unit+' cumulative total</small>'
    : m.total
    ? rawTotal.toFixed(m.dp)+' <small>'+m.unit+' total · '+avg.toFixed(m.dp)+' avg/bucket · last '+last.toFixed(m.dp)+'</small>'
    : m.peak
    ? avg.toFixed(m.dp)+' <small>'+m.unit+' avg · peak '+peak.toFixed(m.dp)+' · last '+last.toFixed(m.dp)+'</small>'
    : last.toFixed(m.dp)+' <small>'+m.unit+' last · '+avg.toFixed(m.dp)+' avg</small>'
}

async function load(){
  const orgId = $('#org').value
  if(!orgId) throw new Error('no org')
  const q = new URLSearchParams({
    org_id: orgId,
    from: $('#from').value+'T00:00:00Z',
    to:   $('#to').value+'T23:59:59Z',
    granularity: $('#gran').value,
  })
  const proj = $('#project').value
  if(proj) q.set('project_ids', proj)
  else {
    const projectIds = [...$('#project').options].map(o=>o.value).filter(Boolean)
    if(projectIds.length) q.set('project_ids', projectIds.join(','))
  }
  const j = await api('/consumption?'+q.toString())
  const rows = rowsFrom(j)
  if(!rows.length){ setStatus('no data in range', true); return }

  const span = spanSec()
  if(!Object.keys(charts).length) buildGrid()
  for(const m of METRICS){
    const ch = charts[m.id]
    const isCumulative = m.cumulative && cumulative[m.id]
    ch.options.scales.y.stacked = false
    ch.options.plugins.legend.display = false
    ch.data.datasets = [{ label:m.unit, data: bucketPoints(rows,m,span,isCumulative),
      borderColor:m.color, backgroundColor:m.color+'22', fill:true, tension:.25, pointRadius:0, borderWidth:1.5 }]
    ch.update('none')                                  // preserves zoom

    ch.$rawTotal = rows.reduce((sum,r)=>sum+m.val(r,span),0)
    renderBig(m,ch)
  }
  await loadTotals()
  setStatus('loaded '+rows.length+' buckets · '+($('#project').selectedOptions[0]?.text||'')+
            ($('#poll').checked?' · live':'')+' · drag chart to zoom')
}

async function tick(){
  if(busy) return
  busy = true
  try{ await load() }catch(e){ setStatus(e.message,true) }finally{ busy=false }
}
function setPolling(on){
  $('#live').className = 'dot'+(on?'':' off')
  if(pollTimer){ clearInterval(pollTimer); pollTimer=null }
  if(on){ tick(); pollTimer=setInterval(tick,5000) }
}

;(function init(){
  const saved = localStorage.getItem(KEY_LS)
  if(saved) $('#key').value = saved
  const to=new Date(), from=new Date(Date.now()-40*864e5)
  $('#to').value=to.toISOString().slice(0,10)
  $('#from').value=from.toISOString().slice(0,10)

  async function refreshOrgProjects(){
    const orgs = await loadOrgs()
    if(orgs[0]) await loadProjects(orgs[0].id)
  }
  $('#key').addEventListener('change', ()=>{
    const v=$('#key').value.trim()
    if(v) localStorage.setItem(KEY_LS,v)
    refreshOrgProjects().catch(e=>setStatus(e.message,true))
  })
  $('#org').addEventListener('change', ()=> loadProjects($('#org').value).then(()=>tick()).catch(e=>setStatus(e.message,true)))
  $('#project').addEventListener('change', ()=> tick())
  $('#reset').addEventListener('click', ()=> Object.values(charts).forEach(c=>c.resetZoom()))
  $('#forget').addEventListener('click', ()=>{ localStorage.removeItem(KEY_LS); $('#key').value=''; setPolling(false); $('#poll').checked=false; setStatus('key forgotten') })
  $('#poll').addEventListener('change', e=> setPolling(e.target.checked))
  $('#f').addEventListener('submit', e=>{ e.preventDefault(); tick() })

  if(saved){
    refreshOrgProjects().then(()=>load()).catch(e=>setStatus(e.message,true))
  }
})()
</script>
</body>
</html>`

export default async function handler(req) {
  const url = new URL(req.url)
  const p = url.pathname

  if (p === '/' || p === '/index.html')
    return new Response(HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })

  if (p.startsWith('/api/')) {
    const key = req.headers.get('x-neon-key')
    if (!key) return Response.json({ message: 'missing x-neon-key' }, { status: 400 })

    if (p === '/api/orgs') return neon('/users/me/organizations', key)
    if (p === '/api/projects') {
      const org = url.searchParams.get('org_id') || ''
      return neon('/projects?org_id=' + encodeURIComponent(org) + '&limit=200', key)
    }
    if (p === '/api/consumption')
      return neon('/consumption_history/projects?' + url.searchParams.toString(), key)
    // Project/branch detail expose current-period totals (data_transfer_bytes,
    // logical_size, data_storage_bytes_hour, cpu_used_sec) absent from consumption_history.
    if (p === '/api/project') {
      const id = url.searchParams.get('project_id') || ''
      return neon('/projects/' + encodeURIComponent(id), key)
    }
    if (p === '/api/branches') {
      const id = url.searchParams.get('project_id') || ''
      return neon('/projects/' + encodeURIComponent(id) + '/branches', key)
    }

    return Response.json({ message: 'unknown api route' }, { status: 404 })
  }

  return new Response('not found', { status: 404 })
}
