import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev: `bun run api` runs the edge handler on :8787; Vite proxies /api to it.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:8787' } },
})
