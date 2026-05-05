import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './', // Important for Electron
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/tldraw') || id.includes('node_modules/@tldraw')) return 'tldraw'
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom') || id.includes('node_modules/axios')) return 'vendor'
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
})
