import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { threeCdnExternal } from '../shared/build/three-cdn-external';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // threeCdnExternal keeps Three.js out of the bundle AND out of dev pre-bundling, so the
  // browser import map is the only thing that ever resolves it (PRD §13).
  plugins: [threeCdnExternal(), react()],
  build: {
    outDir: resolve(here, '../server/public/client-build'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
});
