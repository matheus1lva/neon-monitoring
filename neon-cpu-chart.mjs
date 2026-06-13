// Local dev server. Run: bun neon-cpu-chart.mjs  ->  open http://localhost:8787
// Prod runs on Vercel via api/index.js (edge function); both share the same handler.
import handler from './api/index.js'

const PORT = 8787

Bun.serve({ port: PORT, fetch: handler })

console.log(`neon dashboard → http://localhost:${PORT}`)
