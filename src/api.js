// Calls the /api/* edge proxy (api/index.js). Key is sent per-request, never persisted server-side.
export async function api(path, key) {
  if (!key) throw new Error('enter API key')
  const r = await fetch('/api' + path, { headers: { 'x-neon-key': key } })
  const j = await r.json()
  if (!r.ok) throw new Error(j.message || ('HTTP ' + r.status))
  return j
}
