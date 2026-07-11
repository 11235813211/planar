import { defineConfig } from 'vite'

export default defineConfig({
  base: '/planar/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
