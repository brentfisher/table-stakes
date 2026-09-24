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
import layout from '../../../../shared/game-data/restaurant-layout.json' with { type: 'json' };

const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);

// STORY-067. The §14 layout's own `barriers` (see its `_barriers_comment`) — solid segments the
// owner may not cross except through a declared opening. Read once at module load, not per tick.
// Presently exactly one: the pass counter. THE OWNER ONLY: `worker-system.js` moves workers on
// its own path and the server worker must cross the pass to carry plates to tables, so applying
// this there would need real pathfinding through the opening. That is a deliberate cut, not an
// oversight.
const BARRIERS = layout.barriers ?? [];

/**
 * How far past a barrier a blocked move is parked. One clamp-epsilon, so the owner ends the tick
 * demonstrably on the side they started rather than exactly ON the line, where the next tick's
 * own `from === at` comparison would be a coin flip between "crossed" and "did not".
 */
const BARRIER_EPSILON = 0.01;

/**
 * Integrate one step with the authority clamp AND the barrier check, and write it to `player`.
 * EVERY movement path goes through here — walk, sprint, and post-sprint slide — so there is no
 * route that clamps but forgets to collide. That is the whole reason this is a function rather
 * than three copies of two `clamp` calls, which is what this file used to carry.
 *
 * Barriers are tested as a LINE CROSSING, not as a box the owner might be inside: solve for where
 * the step's own segment meets the barrier's axis, and ask whether THAT point is inside an
 * opening. A point-in-box test would let a fast enough tick step cleanly over a thin barrier
 * (today's worst case is a sprint tick at 7.14 u/s * 50ms = 0.357 units against a counter 1.48
 * deep, so it would not tunnel right now — but that is arithmetic that holds by luck, and a
 * crossing test does not depend on it surviving a future speed or geometry change).
 *
 * A blocked move keeps its travel ALONG the barrier and loses only the component through it, so
 * walking into the counter slides the owner along it toward the opening instead of sticking them
 * in place — the behaviour a player expects from a countertop.
 */
function integrate(player, dx, dz) {
  const fromX = player.position.x;
  const fromZ = player.position.z;
  let toX = clamp(fromX + dx, RESTAURANT_BOUNDS.minX, RESTAURANT_BOUNDS.maxX);
  let toZ = clamp(fromZ + dz, RESTAURANT_BOUNDS.minZ, RESTAURANT_BOUNDS.maxZ);

  for (const barrier of BARRIERS) {
    const alongAxis = barrier.axis === 'z' ? 'x' : 'z';
    const from = barrier.axis === 'z' ? fromZ : fromX;
    const to = barrier.axis === 'z' ? toZ : toX;
    // Not a crossing: both ends on the same side of the line (or the step never moved along
    // this axis at all). `from === barrier.at` counts as "already on the line", which the
    // epsilon above is what stops happening in the first place.
    if ((from < barrier.at && to < barrier.at) || (from > barrier.at && to > barrier.at)) continue;
    if (from === to) continue;

    // Where along the OTHER axis the step's own segment meets the barrier.
    const t = (barrier.at - from) / (to - from);
    const crossFrom = alongAxis === 'x' ? fromX : fromZ;
    const crossTo = alongAxis === 'x' ? toX : toZ;
    const crossAt = crossFrom + (crossTo - crossFrom) * t;
    if (barrier.openings.some((o) => crossAt >= o.min && crossAt <= o.max)) continue;

    // Blocked. Park just short of the line on the side the step started from, and keep the
    // full movement along it.
    const parked = from < barrier.at ? barrier.at - BARRIER_EPSILON : barrier.at + BARRIER_EPSILON;
    if (barrier.axis === 'z') toZ = parked;
    else toX = parked;
  }

  player.position.x = toX;
  player.position.z = toZ;
}

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
        // an out-of-bounds broadcast position. STORY-067 folded that clamp into `integrate`
        // alongside the barrier crossing — same clamp, same guarantee, one place.
        integrate(player, nx, nz);
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
        // integrate position from the decayed vector, through the same `integrate` as every
        // other movement path so a slide can neither leave `RESTAURANT_BOUNDS` nor coast through
        // a barrier. New
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
        integrate(player, player.slideVelocity.x * dt, player.slideVelocity.z * dt);
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
        integrate(player, nx, nz);
      }
    }
  },
};
