import type { ConfigEnv, Plugin, UserConfig } from 'vite';
import { THREE_VERSION, THREE_CDN_BASE } from '../constants/tuning.js';

/**
 * Keeps Three.js out of every bundle and out of dev dependency pre-bundling, so it is only
 * ever fetched from the pinned CDN (PRD §13). `three` is deliberately not installed in
 * node_modules, so without this plugin Vite fails to resolve it in BOTH modes.
 *
 * The two modes are handled differently, on purpose:
 *
 *   build — the import is left as the bare specifier `three`, so the browser's import map in
 *           index.html is what resolves it. This is the shape the PRD requires and the shape
 *           `scripts/check-threejs-pin.mjs` verifies against the build output.
 *
 *   dev   — Vite's dev server rewrites every bare specifier and does not honour
 *           `external: true` from `resolveId` (nor does `environments.client.resolve.external`,
 *           which is an SSR concern). So in dev the specifier is rewritten to the SAME pinned
 *           CDN URL the import map points at, derived from THREE_VERSION.
 *
 * Both modes therefore load the identical pinned build from the identical CDN, and
 * THREE_VERSION remains the single source of truth. The trade is that `vite dev` does not
 * itself exercise the import map — run `npm run build:client && npm start` to check that path.
 */
export function threeCdnExternal(): Plugin {
  const isThree = (id: string) => id === 'three' || id.startsWith('three/');

  const cdnUrlFor = (id: string): string => {
    if (id === 'three') return `${THREE_CDN_BASE}/build/three.module.js`;
    if (id.startsWith('three/addons/')) {
      return `${THREE_CDN_BASE}/examples/jsm/${id.slice('three/addons/'.length)}`;
    }
    return `${THREE_CDN_BASE}/${id.slice('three/'.length)}`;
  };

  let isServe = false;

  return {
    name: 'three-cdn-external',
    enforce: 'pre',

    config(_config: UserConfig, env: ConfigEnv) {
      isServe = env.command === 'serve';
      return {
        optimizeDeps: { exclude: ['three'] },
        build: { rollupOptions: { external: isThree } },
      };
    },

    resolveId(source: string) {
      if (!isThree(source)) return null;
      return isServe
        ? { id: cdnUrlFor(source), external: true }
        : { id: source, external: true };
    },
  };
}

export const PINNED_THREE_VERSION: string = THREE_VERSION;
