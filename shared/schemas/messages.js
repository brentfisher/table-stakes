// Wire protocol message types. PRD §12 "WebSocket messages".
//
// SCOPE NOTE (STORY-001): Milestone 0 needs only the movement and snapshot path. The full
// MVP protocol — `interact`, `purchase_upgrade`, `setup_submit`, `event_announce`,
// `match_complete` — is owned by STORY-002, which expands this module and adds
// game-state.ts and validation. The constants below are declared in full now so that
// STORY-002 widens the validators rather than renaming anything.

export const CLIENT_MESSAGE_TYPES = Object.freeze([
  'join_room',
  'player_input',
  'interact',
  'purchase_upgrade',
  'setup_submit',
]);

export const SERVER_MESSAGE_TYPES = Object.freeze([
  'joined',
  'match_snapshot',
  'event_announce',
  'match_complete',
  'error',
]);

/** Milestone 0 implements this subset; the rest are rejected until STORY-002. */
export const IMPLEMENTED_CLIENT_MESSAGE_TYPES = Object.freeze(['join_room', 'player_input']);
