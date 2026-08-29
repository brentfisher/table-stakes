/// <reference types="vite/client" />

// Three.js RUNTIME comes from the pinned CDN import map (PRD §13) and is marked external in
// vite.config.ts, so no Three.js code ever enters the bundle. Its TYPES come from
// @types/three, pinned to the exact same version as THREE_VERSION — a devDependency that is
// erased at compile time and contributes nothing at runtime. scripts/check-threejs-pin.mjs
// enforces both halves: `three` is never a dependency, and @types/three matches the pin.
declare module 'three/addons/*';
