// STORY-025. Display metadata for the "Play vs Bot" menu screen (`PlayVsBotScreen.tsx`) and for
// naming a bot opponent on `ResultsPanel`/`HudPanel` — same "one lookup table, shared by every
// panel that needs it" convention `event-titles.ts` already uses for event titles.
//
// THE ONE RULE THIS FILE MUST NOT BREAK: `BOT_PROFILE_IDS` below is not a second enum. Every id
// here is, verbatim, a member of `BOT_DIFFICULTIES` (`shared/constants/tuning.js`) — the same
// array `server/src/game/bot/bot-controller.js#normalizeBotDifficulty` gates against. This file
// only adds a player-facing LABEL and a short description for each one, exactly the role
// `shared/schemas/setup-rules.js#PRICE_GUIDANCE_LABELS` plays for price feedback: a display
// string next to an existing source of truth, never a parallel source of truth itself.
//
// `easy` is deliberately labeled "Practice" and marked `devOnly` here rather than getting a
// sixth `BOT_DIFFICULTIES` member: it already exists (it is STORY-017's `BOT_DEFAULT_DIFFICULTY`)
// and already behaves like a low-pressure opponent (`BOT_MISTAKE_PROBABILITY.easy` misses about
// a third of its own opportunities) — the ONLY thing STORY-025 adds for it is a friendlier
// player-facing name, gated out of the production build the same way `PLAY_VS_BOT_AVAILABLE`
// used to gate the whole menu entry. `hard` has no menu entry at all: nothing in this story's
// acceptance criteria asks for a fourth public profile, and STORY-017's own dev/test callers
// (`POST /dev/match`, `scripts/check-bot.mjs`) keep reaching it directly by name.

import { BOT_DIFFICULTIES, BOT_DEFAULT_DIFFICULTY } from '../../../shared/constants/tuning';

export interface BotProfile {
  /** A `BOT_DIFFICULTIES` member — sent to the server verbatim as `botDifficulty`. */
  id: string;
  label: string;
  description: string;
  /** True for the one profile (`Practice`/`easy`) only ever offered in a development build. */
  devOnly: boolean;
}

const PROFILE_META: Record<string, { label: string; description: string; devOnly: boolean }> = {
  [BOT_DEFAULT_DIFFICULTY]: {
    label: 'Practice',
    description: 'A relaxed opponent for trying out the flow — development builds only.',
    devOnly: true,
  },
  balanced: {
    label: 'Balanced',
    description: 'A well-rounded rival: steady reactions, occasional slip-ups.',
    devOnly: false,
  },
  fast_service: {
    label: 'Fast Service',
    description: 'Reacts to the floor almost instantly — the quickest hands in the district.',
    devOnly: false,
  },
  premium: {
    label: 'Premium',
    description: 'Deliberate and nearly mistake-free — a polished, precise operator.',
    devOnly: false,
  },
};

/**
 * Every menu-eligible profile, in `BOT_DIFFICULTIES` order (`.filter` skips `hard`, which has
 * no `PROFILE_META` entry and no menu slot — see this file's own header). `includeDevOnly`
 * false (the production-build default) drops `Practice` — `PlayVsBotScreen.tsx` passes
 * `import.meta.env.DEV` through here rather than duplicating the filter itself.
 */
export function botProfileOptions(includeDevOnly: boolean): BotProfile[] {
  return BOT_DIFFICULTIES.filter((id) => PROFILE_META[id] && (includeDevOnly || !PROFILE_META[id].devOnly)).map(
    (id) => ({ id, ...PROFILE_META[id] }),
  );
}

/** The player-facing name for a bot's `difficulty` id — `ResultsPanel`/`HudPanel` naming a bot
 * opponent instead of a generic "Rival". Falls back to the raw id (never a raw `easy`/`hard` in
 * practice, since every id `attachBot` can be given today has a `PROFILE_META` entry, but a
 * fallback keeps this honest if a future difficulty is added without a label). */
export function botProfileLabel(difficulty: string | null | undefined): string {
  if (!difficulty) return 'Bot';
  return PROFILE_META[difficulty]?.label ?? difficulty;
}
