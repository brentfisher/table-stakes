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
  OWNER_SPRINT_SLIDE_DECEL_PER_S2,
  OWNER_SPRINT_SLIDE_STOP_SPEED,
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

      if (player.sprinting && len > 0) {
        // Sprinting: move straight from input at sprint speed, same as before STORY-061. Also
        // keep `slideVelocity` "topped up" to this tick's sprint velocity every tick sprint is
        // active, so that whichever tick sprint ends (key released, or `sprintRemainingMs` hits
        // zero above) there is a real, current momentum vector ready to coast from below — never
        // a stale one from several ticks ago.
        const speed = OWNER_MOVE_SPEED * OWNER_SPRINT_MULTIPLIER;
        const dirX = player.input.x / len;
        const dirZ = player.input.z / len;
        const nx = dirX * speed * dt;
        const nz = dirZ * speed * dt;
        // THE authority check: the server clamps, so an out-of-bounds intent cannot produce
        // an out-of-bounds broadcast position.
        player.position.x = clamp(player.position.x + nx, RESTAURANT_BOUNDS.minX, RESTAURANT_BOUNDS.maxX);
        player.position.z = clamp(player.position.z + nz, RESTAURANT_BOUNDS.minZ, RESTAURANT_BOUNDS.maxZ);
        player.slideVelocity.x = dirX * speed;
        player.slideVelocity.z = dirZ * speed;
        continue;
      }

      const slideSpeed = Math.hypot(player.slideVelocity.x, player.slideVelocity.z);
      if (slideSpeed > OWNER_SPRINT_SLIDE_STOP_SPEED) {
        // STORY-061 "a little bit of ice": sprint just ended (this tick or an earlier one) with
        // real momentum still in `slideVelocity`. Coast on that momentum instead of falling
        // straight through to plain input-driven walking — decay the vector's magnitude at a
        // fixed rate (see `OWNER_SPRINT_SLIDE_DECEL_PER_S2`'s reasoning in tuning.js) and
        // integrate position from the decayed vector, through the same clamp as every other
        // movement path so a slide can never carry a player out of `RESTAURANT_BOUNDS`. New
        // walk/sprint input is intentionally ignored for the brief remainder of the slide — that
        // loss of instant manual control is the "ice" — and resumes the instant the slide spends
        // itself out below `OWNER_SPRINT_SLIDE_STOP_SPEED`. This includes a fresh sprint key
        // press: tapping sprint again mid-slide does nothing until the slide ends (at most
        // ~0.3s later per `OWNER_SPRINT_SLIDE_DECEL_PER_S2`'s own comment) rather than instantly
        // re-accelerating out of the skid — consistent with "ice" being something you ride out,
        // not cancel at will.
        const decayedSpeed = Math.max(0, slideSpeed - OWNER_SPRINT_SLIDE_DECEL_PER_S2 * dt);
        const scale = decayedSpeed / slideSpeed;
        player.slideVelocity.x *= scale;
        player.slideVelocity.z *= scale;
        player.position.x = clamp(
          player.position.x + player.slideVelocity.x * dt,
          RESTAURANT_BOUNDS.minX,
          RESTAURANT_BOUNDS.maxX,
        );
        player.position.z = clamp(
          player.position.z + player.slideVelocity.z * dt,
          RESTAURANT_BOUNDS.minZ,
          RESTAURANT_BOUNDS.maxZ,
        );
        continue;
      }

      // No sprint momentum left to coast on (or there never was any) — snap it to exactly zero
      // (see `OWNER_SPRINT_SLIDE_STOP_SPEED`'s own comment for why this isn't left to asymptote)
      // and fall back to today's plain input-driven walking.
      player.slideVelocity.x = 0;
      player.slideVelocity.z = 0;
      if (len > 0) {
        const nx = (player.input.x / len) * OWNER_MOVE_SPEED * dt;
        const nz = (player.input.z / len) * OWNER_MOVE_SPEED * dt;
        player.position.x = clamp(player.position.x + nx, RESTAURANT_BOUNDS.minX, RESTAURANT_BOUNDS.maxX);
        player.position.z = clamp(player.position.z + nz, RESTAURANT_BOUNDS.minZ, RESTAURANT_BOUNDS.maxZ);
      }
    }
  },
};
