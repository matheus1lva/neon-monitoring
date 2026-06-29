// Vercel edge function: proxies Neon API calls for the dashboard SPA.
// (Neon API sends no CORS headers, so the browser can't call it directly.)
// Local dev: neon-cpu-chart.mjs imports this handler on :8787; Vite proxies /api to it.
//
// v1 (/consumption_history/projects): 4 metrics, finer CPU/activity series.
// v2 (/consumption_history/v2/projects): billing-aligned metrics (compute units, storage
//   breakdown, network transfer, extra branches); requires the metrics query param.
import { neon as pg } from '@neondatabase/serverless'

export const config = { runtime: 'edge' }

const NEON = 'https://console.neon.tech/api/v2'

async function neon(path, key) {
  const r = await fetch(NEON + path, {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }
  })
  return new Response(await r.text(), { status: r.status, headers: { 'Content-Type': 'application/json' } })
}

// Same proxy but parsed, for routes that chain multiple Neon API calls.
async function neonJSON(path, key) {
  const r = await fetch(NEON + path, { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' } })
  const j = await r.json()
  if (!r.ok) throw new Error(j.message || ('Neon API ' + r.status))
  return j
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
  // Query performance (pg_stat_statements) has no Neon REST endpoint — we fetch a
  // connection URI with the API key and run the SQL ourselves over the serverless driver.
  if (p === '/api/query_perf') {
    const id = url.searchParams.get('project_id')
    if (!id) return Response.json({ message: 'missing project_id' }, { status: 400 })
    const proj = '/projects/' + encodeURIComponent(id)
    try {
      const { branches } = await neonJSON(proj + '/branches', key)
      const branch = (branches || []).find(b => b.default) || (branches || [])[0]
      if (!branch) return Response.json({ message: 'no branches in project' }, { status: 404 })
      const { databases } = await neonJSON(proj + '/branches/' + branch.id + '/databases', key)
      const db = (databases || [])[0]
      if (!db) return Response.json({ message: 'no databases in branch' }, { status: 404 })
      const { uri } = await neonJSON(proj + '/connection_uri?pooled=true'
        + '&database_name=' + encodeURIComponent(db.name)
        + '&role_name=' + encodeURIComponent(db.owner_name), key)
      const sql = pg(uri)
      const queries = await sql`
        SELECT queryid::text AS queryid, left(query, 300) AS query,
               calls, total_exec_time, mean_exec_time, rows
        FROM pg_stat_statements
        WHERE query IS NOT NULL
        ORDER BY total_exec_time DESC
        LIMIT 100`
      return Response.json({ queries, database: db.name })
    } catch (e) {
      const msg = /pg_stat_statements/.test(e.message)
        ? 'pg_stat_statements not enabled on this database'
        : e.message
      return Response.json({ message: msg }, { status: 502 })
    }
  }

  return Response.json({ message: 'unknown api route' }, { status: 404 })
}
