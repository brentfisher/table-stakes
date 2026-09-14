import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { threeCdnExternal } from '../shared/build/three-cdn-external';

export default defineConfig(({ command }) => ({
  // Same Three.js rule as the client: never bundled, never installed — resolved from the
  // pinned CDN in the build (via the import map) and in dev (via the same pinned URL).
  plugins: [threeCdnExternal()],
  // `server/src/index.js` serves the built harnesses under `/harnesses/` alongside the client
  // (both from one origin, same reasoning as `client/dist`), so the build's own asset paths
  // must be rooted there too — dev keeps the default `/` since `dev:harnesses` serves it from
  // its own root at :5174 with no sub-path involved.
  base: command === 'build' ? '/harnesses/' : '/',
  build: { outDir: 'dist' },
  server: {
    port: 5174,
    fs: { allow: ['.', '../client', '../shared', '../assets'].map((path) => fileURLToPath(new URL(path, import.meta.url))) },
  },
}));
