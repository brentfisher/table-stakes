// The setup phase's tick-side half: it closes the setup phase.
//
// Registered against `simulation-loop.js` (Decision 15) rather than wired into `match.js`, so
// this story adds a file and one registration line and collides with nobody.
//
// It does two things, both at the setup -> service boundary:
//
//   1. FILLS IN A MISSING SUBMISSION. PRD §5 lets setup end on the timer, so a player who
//      never submitted is a normal case, not an error. Every later system needs a menu to
//      exist for both restaurants, so they get `defaultSubmission()` — validated through the
//      same validator as a real one.
//   2. LOCKS BOTH MENUS. PRD §7: "Players can alter the menu only during setup in MVP", and
//      §20 puts dynamic menu changes during service out of scope. `locked` makes that a
//      property of the stored submission rather than a phase check somebody can forget:
//      `acceptSetupSubmission` refuses a locked submission whatever the phase says.
//
// There is no per-tick work during setup — the player is reading and clicking, and the phase
// clock is `match.js`'s job — so `update` is deliberately empty. `registerSystem` requires an
// `update`, and an honest no-op is better than inventing busywork for it.

import { defaultSubmission } from '../validators/setup-validator.js';

export const setupSystem = {
  id: 'setup',

  // Only `setup` — see the note above about `update`. `onPhaseChange` fires regardless of
  // this list (simulation-loop.js calls it for every registered system), which is what lets a
  // setup-only system act on the transition OUT of setup.
  phases: ['setup'],

  update() {},

  onPhaseChange(match, { from, to }) {
    if (from !== 'setup') return;

    for (const player of match.players.values()) {
      if (!player.setup) {
        player.setup = defaultSubmission();
        player.setup.submittedAtMs = Math.round(match.elapsedMs);
        console.log(
          `[setup] ${match.id} ${player.playerId} never submitted — default menu applied ` +
            `(${player.setup.menu.map((slot) => slot.dishId).join(', ')})`,
        );
      }
      player.setup.locked = true;
    }

    console.log(`[setup] ${match.id} menus locked entering ${to}`);
  },
};
