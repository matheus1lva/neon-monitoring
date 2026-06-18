// Local dev API server. Run: bun run api  (serves the /api proxy on :8787)
// Then run: bun run dev  (Vite serves the React UI and proxies /api here).
// Prod runs the same handler as a Vercel edge function (api/index.js).
import handler from './api/index.js'

const PORT = 8787

Bun.serve({ port: PORT, fetch: handler })

console.log(`neon api proxy → http://localhost:${PORT}/api/*  (run \`bun run dev\` for the UI)`)
