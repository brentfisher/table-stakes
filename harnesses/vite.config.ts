import { defineConfig } from 'vite';
import { threeCdnExternal } from '../shared/build/three-cdn-external';

export default defineConfig({
  // Same Three.js rule as the client: never bundled, never installed — resolved from the
  // pinned CDN in the build (via the import map) and in dev (via the same pinned URL).
  plugins: [threeCdnExternal()],
  build: { outDir: 'dist' },
  server: { port: 5174 },
});
