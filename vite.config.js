import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    proxy: {
      // `/api` + `/ws` are proxied to the Django / Daphne ASGI server.
      // The port MUST match wherever `run_daphne.sh` (or your manual
      // `python -m daphne -b … -p … devrose_backend.asgi:application`)
      // actually binds — `run_daphne.sh` currently uses :8000. If you
      // change daphne's port, change BOTH targets here, otherwise the
      // browser will see a 500 from the upstream-connection-error and
      // the FE will toast "Connection Error" on every initial load.
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://127.0.0.1:8000',
        ws: true,
        changeOrigin: true,
      }
    }
  }
})
