import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'child_process'

let gitHash = 'dev'
try {
  gitHash = execSync('git rev-parse --short HEAD').toString().trim()
} catch {}

export default defineConfig({
  plugins: [react()],
  define: {
    __GIT_HASH__: JSON.stringify(gitHash),
  },
})
