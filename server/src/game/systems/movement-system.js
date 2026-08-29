// Owner movement. PRD §13's layout names this file; STORY-001 had the same code inline in
// `match.js` because there was no seam to hang it on. STORY-003 built the seam, so this is
// both the real movement system and the worked example stories 004/005/009/011 can copy.
//
// PRD §12 "Networking model": the browser sends intent, the server integrates and clamps.
// This is the file where that clamp happens, and `scripts/smoke-milestone0.mjs` proves it by
// sending `{x: 999, z: 999}` and requiring an in-bounds broadcast position.
//
// NO `phases` KEY, on purpose. The owner avatar stands on the restaurant floor for the whole
// match, and gating movement by phase is a gameplay decision (does the owner walk around
// during the market reveal?) that belongs to the setup and HUD stories, not to the story that
// built the clock. It also keeps the Milestone 0 clamp check honest: those rooms sit in
// `lobby` because nobody readies up, and a phase-gated movement system would make the check
// pass by doing nothing. A later story that wants a gate adds `phases: [...]` on this object.

import {
  RESTAURANT_BOUNDS,
  OWNER_MOVE_SPEED,
  OWNER_SPRINT_MULTIPLIER,
  OWNER_SPRINT_MAX_MS,
  OWNER_SPRINT_COOLDOWN_MS,
} from '../../../../shared/constants/tuning.js';

const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);

export const movementSystem = {
  id: 'movement',

  update(match, dtMs) {
    const dt = dtMs / 1000;

    for (const player of match.players.values()) {
      const wantsSprint =
        player.input.sprint && player.sprintCooldownMs <= 0 && player.sprintRemainingMs > 0;

      if (wantsSprint) {
        player.sprinting = true;
        player.sprintRemainingMs = Math.max(0, player.sprintRemainingMs - dtMs);
        if (player.sprintRemainingMs === 0) player.sprintCooldownMs = OWNER_SPRINT_COOLDOWN_MS;
      } else {
        player.sprinting = false;
        if (player.sprintCooldownMs > 0) {
          player.sprintCooldownMs = Math.max(0, player.sprintCooldownMs - dtMs);
          if (player.sprintCooldownMs === 0) player.sprintRemainingMs = OWNER_SPRINT_MAX_MS;
        } else if (player.sprintRemainingMs < OWNER_SPRINT_MAX_MS) {
          player.sprintRemainingMs = Math.min(OWNER_SPRINT_MAX_MS, player.sprintRemainingMs + dtMs * 0.5);
        }
      }

      // Normalize so diagonal movement is not faster than axis-aligned movement.
      const len = Math.hypot(player.input.x, player.input.z);
      if (len > 0) {
        const speed = OWNER_MOVE_SPEED * (player.sprinting ? OWNER_SPRINT_MULTIPLIER : 1);
        const nx = (player.input.x / len) * speed * dt;
        const nz = (player.input.z / len) * speed * dt;
        // THE authority check: the server clamps, so an out-of-bounds intent cannot produce
        // an out-of-bounds broadcast position.
        player.position.x = clamp(player.position.x + nx, RESTAURANT_BOUNDS.minX, RESTAURANT_BOUNDS.maxX);
        player.position.z = clamp(player.position.z + nz, RESTAURANT_BOUNDS.minZ, RESTAURANT_BOUNDS.maxZ);
      }
    }
  },
};
