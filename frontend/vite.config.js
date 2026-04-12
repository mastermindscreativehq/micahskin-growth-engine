import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'child_process'

let gitHash = 'dev'
try {
  gitHash = execSync('git rev-parse --short HEAD').toString().trim()
} catch {}

const buildTime = new Date().toISOString()

export default defineConfig({
  plugins: [
    react(),
    // Emit version.json into the dist root so the boot-check can fetch it.
    {
      name: 'emit-version-json',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'version.json',
          source: JSON.stringify({ hash: gitHash, buildTime }),
        })
      },
    },
  ],
  build: {
    rollupOptions: {
      output: {
        // Explicit content-hashed filenames for long-cache safety.
        entryFileNames: 'assets/[name].[hash].js',
        chunkFileNames: 'assets/[name].[hash].js',
        assetFileNames: 'assets/[name].[hash][extname]',
      },
    },
  },
  define: {
    __GIT_HASH__: JSON.stringify(gitHash),
    __BUILD_TIME__: JSON.stringify(buildTime),
  },
})
