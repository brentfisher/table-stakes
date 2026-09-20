// STORY-063/064/065. The cast-pack characters and which game role each one stands in for.
//
// Built by `assets/cast/build_cast.py` from `cast-pack.blend` — see
// `assets/cast/README_ThreeJS.md` for the runtime contract (meters, +Z forward, root at origin,
// two in-place clips at 30fps) and for the known limitations that were measured against this
// game's actual camera and deliberately accepted.
//
// ROLE MAPPING. `WORKER_ROLE_GLYPHS` in `RestaurantScene.ts` already defines five worker roles;
// two of them have a cast character that fits without inventing anything:
//
//   Monsieur, "the French maître d'"  -> `host`    — a maître d' IS the host. The role already
//                                                    owns the `seat_party` task and the `H` glyph.
//   Vivienne, "the luxury concierge"  -> `server`  — the loosest of the mappings, recorded here
//                                                    so it reads as a considered choice: a
//                                                    concierge is not literally waitstaff, but her
//                                                    navy-and-burgundy uniform reads front-of-house
//                                                    and the cast supplies nothing closer.
//
// `cook`, `prep_worker` and `busser` keep their primitive capsules — the cast pack has no
// character for them. Aurelia is a DINER rather than a worker, so she is absent from the worker
// table and exported separately as `SEATED_DINER_MODEL` below.
import type { RiggedCharacterSpec } from './RiggedCharacterModel';

// Each URL is spelled out as a literal rather than built from the character's name. Vite resolves
// `new URL('...', import.meta.url)` at build time, and a TEMPLATE literal makes the path dynamic,
// which it can only satisfy by bundling every file the pattern could match — that quietly shipped
// `Aurelia.glb` (778 kB) into the client bundle even though nothing imports her yet, because she
// sits in the same directory. Static strings bundle exactly what is referenced.
function castSpec(name: string, url: string): RiggedCharacterSpec {
  return { url, idleClip: `${name}_Idle`, walkClip: `${name}_Walk_InPlace` };
}

/** Aurelia is a SEATED diner: `assets/cast/Aurelia.glb` ships a seated idle and no walk at all
 * (see `build_cast.py`'s SEATED_POSE), so her spec deliberately omits `walkClip`. Her GLB is also
 * scaled and offset for the seated silhouette — 0.99 m crown-to-floor, matching the
 * CapsuleGeometry(0.18, 0.2) + SphereGeometry(0.17) diner primitive she replaces — so she must
 * never be used for a standing role. */
export const SEATED_DINER_MODEL: RiggedCharacterSpec = {
  url: new URL('../../../assets/cast/Aurelia.glb', import.meta.url).href,
  idleClip: 'Aurelia_Idle',
};

/** Worker role -> cast character. A role absent from this table keeps its primitive capsule, so
 * adding a character later is a one-line change here rather than a new branch in `upsertWorker`. */
export const WORKER_ROLE_MODELS: Readonly<Record<string, RiggedCharacterSpec>> = {
  host: castSpec('Monsieur', new URL('../../../assets/cast/Monsieur.glb', import.meta.url).href),
  server: castSpec('Vivienne', new URL('../../../assets/cast/Vivienne.glb', import.meta.url).href),
};
