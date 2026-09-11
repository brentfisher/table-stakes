// STORY-024. The `POST /api/rooms` response shape, as consumed client-side — a narrow view of
// `matchManager.roomStatus(room, {includeInvite: true})` plus the `joinUrl` `routes.js` appends.
// Kept as its own tiny module (not re-declared inline in `MainMenu.tsx`/`App.tsx`) so the two
// never drift on which fields they expect.
export interface CreatedRoom {
  id: string;
  inviteToken: string;
  joinUrl: string;
  hostDisplayName: string | null;
  inviteExpiresAt: number;
  /** STORY-039. `'private_human'` or `'coop'` for either invite-flow room this response can
   * come from — `InvitePanel` reads it to say "opponent" vs "co-op partner" without a second
   * invite type. Optional so older cached values (written before this field existed) still
   * parse; `undefined` reads the same as `'private_human'` everywhere it is checked. */
  mode?: string;
}

const LOBBY_CACHE_PREFIX = 'story024:lobby:';

/** A `/lobby/:roomId` visitor's own invite info, as far as THIS tab knows it. */
export interface CachedInvite {
  inviteToken?: string;
  joinUrl?: string;
  hostDisplayName?: string | null;
  expiresAt?: number;
  /** STORY-039. See `CreatedRoom.mode`'s own comment. */
  mode?: string;
}

/**
 * Recovers a host's own invite link (or a guest's `inviteToken`) across a HARD reload of
 * `/lobby/:roomId` — the normal path (set right when `MainMenu`'s "Invite Opponent" creates the
 * room, or when `JoinInvitePage` resolves a join) hands this to `App.tsx` via `navigate()`
 * alone, which does not survive a reload. `sessionStorage`, not a server round-trip:
 * `GET /api/rooms/:roomId` deliberately never re-serves the raw `inviteToken` (see
 * `roomStatus`'s own header — it is a secret, and `roomId` is guessable), so the ONE place this
 * can come from after in-memory state is gone is the browser tab that minted or redeemed it.
 * Best-effort only: a private window, a cleared tab, or a different browser loses it, same as
 * this app's pre-existing "nothing else persists across a reload" limitation.
 */
export function cacheInvite(roomId: string, invite: CachedInvite): void {
  try {
    sessionStorage.setItem(LOBBY_CACHE_PREFIX + roomId, JSON.stringify(invite));
  } catch {
    // Storage can be unavailable (private mode, quota); the tab simply cannot recover the
    // link/token after a reload, which is the same degraded outcome as if this call never ran.
  }
}

export function readCachedInvite(roomId: string): CachedInvite | null {
  try {
    const raw = sessionStorage.getItem(LOBBY_CACHE_PREFIX + roomId);
    return raw ? (JSON.parse(raw) as CachedInvite) : null;
  } catch {
    return null;
  }
}
