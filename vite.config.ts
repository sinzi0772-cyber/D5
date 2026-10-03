import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const noCacheHeaders = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
}

export default defineConfig({
  plugins: [react()],
  server: { headers: noCacheHeaders },
  preview: { headers: noCacheHeaders },
})
