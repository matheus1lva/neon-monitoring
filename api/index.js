// Vercel edge function: proxies Neon API calls for the dashboard SPA.
// (Neon API sends no CORS headers, so the browser can't call it directly.)
// Local dev: neon-cpu-chart.mjs imports this handler on :8787; Vite proxies /api to it.
//
// v1 (/consumption_history/projects): 4 metrics, finer CPU/activity series.
// v2 (/consumption_history/v2/projects): billing-aligned metrics (compute units, storage
//   breakdown, network transfer, extra branches); requires the metrics query param.
export const config = { runtime: 'edge' }

const NEON = 'https://console.neon.tech/api/v2'

async function neon(path, key) {
  const r = await fetch(NEON + path, {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }
  })
  return new Response(await r.text(), { status: r.status, headers: { 'Content-Type': 'application/json' } })
}

export default async function handler(req) {
  const url = new URL(req.url)
  const p = url.pathname
  if (!p.startsWith('/api/')) return new Response('not found', { status: 404 })

  const key = req.headers.get('x-neon-key')
  if (!key) return Response.json({ message: 'missing x-neon-key' }, { status: 400 })

  if (p === '/api/orgs') return neon('/users/me/organizations', key)
  if (p === '/api/projects') {
    const org = url.searchParams.get('org_id') || ''
    return neon('/projects?org_id=' + encodeURIComponent(org) + '&limit=200', key)
  }
  if (p === '/api/consumption')
    return neon('/consumption_history/projects?' + url.searchParams.toString(), key)
  if (p === '/api/consumption_v2')
    return neon('/consumption_history/v2/projects?' + url.searchParams.toString(), key)
  // Project/branch detail expose current-period totals (data_transfer_bytes, logical_size,
  // data_storage_bytes_hour, cpu_used_sec) absent from consumption_history.
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
