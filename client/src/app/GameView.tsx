// STORY-023. This is the ENTIRE pre-existing render tree from `App.tsx`, extracted verbatim so
// it can be mounted at `/game/:roomId` and `/results/:roomId` (see below) instead of being the
// only thing `App` ever rendered. Nothing in this file changed behavior — every panel, the
// `GameClient` lifecycle — is copied as-is; see `App.tsx`'s own header for what actually
// changed (routing) versus what didn't (this).
//
// `/results/:roomId` intentionally reuses this same component rather than a dedicated one, but
// this is NOT a "revisit a finished match's results" viewer — verified against the real server:
// `match.js#join` refuses ANY join, fresh or reconnect-token, once `this.ended` is true
// (`{ error: 'match_ended', reason }`), so a client that was never connected to this match
// mounts, sends `join_room`, and gets that refusal back just like a disconnected player would.
// `GameClient` already turns that into `disconnectedTerminal` (STORY-022), so what actually
// renders is `ReconnectOverlay`'s "Connection lost — the match ended ... ({reason})" with its
// existing Reload affordance — not `ResultsPanel`. That is still an explicit, stated outcome
// (this story's AC for "failed" states), just not a working post-hoc results page; building one
// would mean a second reader of `MatchResult` data alongside `ResultsPanel`'s, which is
// STORY-014's surface, not this story's job. The one case `/results/:roomId` DOES show the real
// `ResultsPanel` is the ordinary one: a still-connected client whose OWN match just ended,
// which never actually needs this route — `ResultsPanel` already renders the moment
// `status.matchComplete` arrives while sitting on `/game/:roomId`.

import { useEffect, useRef, useState } from 'react';
import { GameClient, type GameClientStatus } from '../game/GameClient';
import { HudPanel } from '../ui/HudPanel';
import { SetupScreen } from '../ui/SetupScreen';
import { UpgradeTerminal } from '../ui/UpgradeTerminal';
import { ResultsPanel } from '../ui/ResultsPanel';
import { TacticalOverviewPanel } from '../ui/TacticalOverviewPanel';
import { EventBanner } from '../ui/EventBanner';
import { ArcadeToast } from '../ui/ArcadeToast';
import { ReconnectOverlay } from '../ui/ReconnectOverlay';
import { LobbyScreen } from '../ui/LobbyScreen';
import { FrontDoorBoard } from '../ui/FrontDoorBoard';
import type { InviteInfo } from '../ui/InvitePanel';
import { navigate } from './router';

export interface GameViewProps {
  roomId?: string;
  /** STORY-024. Required for a FRESH join against a private-invite room — see
   * `GameClient.start`'s own comment. `undefined` for the dev/bot flow. */
  inviteToken?: string;
  /**
   * STORY-024. Whether this mount came from the invite/lobby entry points (`App.tsx`'s
   * `'lobby'` route) rather than a bare dev `?room=`/shared mid-match link — gates whether
   * `LobbyScreen` renders at all during `matchPhase === 'lobby'`. `invite` (host-only: the
   * `POST /api/rooms` response's link, before the guest has joined) is a further refinement of
   * this, not a replacement for it — a guest has `lobbyUi: true, invite: null`.
   */
  lobbyUi?: boolean;
  invite?: InviteInfo | null;
}

export function GameView({ roomId, inviteToken, lobbyUi = false, invite = null }: GameViewProps): JSX.Element {
  const sceneRef = useRef<HTMLDivElement>(null);
  const clientRef = useRef<GameClient | null>(null);
  const [status, setStatus] = useState<GameClientStatus | null>(null);

  useEffect(() => {
    const container = sceneRef.current;
    if (!container) return undefined;

    const client = new GameClient(container);
    clientRef.current = client;
    // Status arrives on join and once per snapshot (~10 Hz), not per animation frame.
    client.onStatus = (next) => setStatus({ ...next });

    // `roomId` is the route param (`/game/:roomId`, `/results/:roomId`, `/lobby/:roomId`) —
    // `App.tsx` now redirects the old `/?room=<id>` link shape to `/game/<id>` before this
    // component ever mounts, so `roomId` is the only source `client.start` needs; the query
    // string is read here too only as a last-resort fallback for a `GameView` reached with
    // neither (there is currently no such route, but this keeps `client.start(undefined)`'s
    // "create a fresh room" behavior reachable rather than silently dropping it).
    const fallbackRoomId = new URLSearchParams(window.location.search).get('room') ?? undefined;
    client.start(roomId ?? fallbackRoomId, inviteToken);

    return () => {
      clientRef.current = null;
      client.dispose();
    };
    // Deliberately run once per mount plus on a real roomId change — `inviteToken` is only
    // ever meaningful for the FIRST join of a given room (see `GameClient.start`'s own
    // comment), never something this effect should re-run over on its own.
  }, [roomId]);

  // STORY-024. Cosmetic only: once the match leaves `lobby`, reflect that in the address bar
  // as `/game/:roomId` — a bookmark or share of THIS tab now lands back in the match via
  // `App.tsx`'s own `/game/:roomId` handling, rather than a stale `/lobby/:roomId`. Never
  // touches history for the pre-existing dev/bot `?room=` flow or a shared mid-match link
  // (`lobbyUi` false there), and never before the FIRST real snapshot: `status.matchPhase`
  // starts `null` (only the `joined` message has arrived, matchPhase is simply not known yet),
  // which is NOT the same fact as "known to be a phase past lobby" — treating `null` as "past
  // lobby" would rewrite the URL to `/game/:roomId` the instant `joined` arrived, while the
  // lobby screen was still showing.
  useEffect(() => {
    if (!lobbyUi || !status?.roomId || !status.matchPhase || status.matchPhase === 'lobby') return;
    const target = `/game/${status.roomId}`;
    if (window.location.pathname !== target) window.history.replaceState(null, '', target);
  }, [lobbyUi, status?.roomId, status?.matchPhase]);

  return (
    <div className="app">
      <div className="scene" ref={sceneRef} />
      {/* STORY-016 PRD §14 "event banner top-centre with a district-level visual effect" — the
          scene-wide light tint is `RestaurantScene#updateEventEffect`; this is the text half. */}
      <EventBanner status={status} />
      {/* STORY-029 PRD-027 §11 "Arcade toast: upper-center, below banner". Own scoped
          `.arcade-toast*` CSS namespace — see `app.css`'s own comment on why it never touches
          `.event-banner*`. */}
      <ArcadeToast status={status} />
      <HudPanel status={status} onReady={(ready) => clientRef.current?.setReady(ready)} />
      {/* STORY-022. Highest z-index in the sheet (see app.css) — every panel above and below
          this one is reading `status`, which stops updating the instant the socket drops, so
          nothing here needs its own gating besides the two fields this overlay itself owns. */}
      <ReconnectOverlay
        reconnecting={Boolean(status?.reconnecting)}
        disconnectedTerminal={status?.disconnectedTerminal ?? null}
      />
      {/*
        STORY-024. Full-bleed overlay, same pattern as `SetupScreen` just below — mounted only
        during `lobby`, and only for the invite/lobby entry points (`lobbyUi`), never for the
        pre-existing bare dev/bot `?room=` flow or a shared mid-match link, which keep rendering
        only `HudPanel`'s own generic "Ready up" button in `lobby`, exactly as before this story.
      */}
      {lobbyUi && status?.matchPhase === 'lobby' ? (
        <LobbyScreen
          status={status}
          onReady={(ready) => clientRef.current?.setReady(ready)}
          invite={invite}
        />
      ) : null}
      {/*
        PRD §18's setup screen is a full-bleed overlay, mounted only during `setup`. It is
        React UI over a live Three.js canvas — it never reconciles a scene entity, which is
        what PRD §13 and Milestone 0 Decision 5 ask for.
      */}
      {status?.matchPhase === 'setup' ? (
        <SetupScreen
          status={status}
          onSubmit={(payload) => clientRef.current?.submitSetup(payload)}
        />
      ) : null}
      {/*
        STORY-014 (PRD §11 results screen). Renders as soon as `match_complete` has arrived —
        NOT gated on `matchPhase === 'results'` — because a disconnect-triggered end sets
        `endReason` without ever visiting the `results` phase (see match.js's own comment on
        `matchCompleteMessage`); the panel has to cover that path too, not just the normal one.
        Full-bleed overlay, same `SetupScreen` pattern above it in this tree.
      */}
      {status?.matchComplete ? (
        <ResultsPanel
          status={status}
          onRematch={() => {
            // No `rematch` client message exists (see NetworkClient.ts) and none is added — a
            // fresh room-less visit to the menu is exactly PRD §12 room-flow step 1 ("create a
            // room"). STORY-023 gives that a real destination now: back to `/`, not a
            // same-path reload into an empty `?room=`-less game view.
            navigate('/');
          }}
        />
      ) : null}
      {/* STORY-012. Opens on proximity, not an `E` press — see
          `InteractionController#nearUpgradeTerminal`'s own comment for why. */}
      {status?.nearUpgradeTerminal ? (
        <UpgradeTerminal
          cash={status.cash}
          purchasedUpgradeIds={status.purchasedUpgradeIds}
          onBuy={(upgradeId) => clientRef.current?.buyUpgrade(upgradeId)}
        />
      ) : null}
      {status?.nearHostStand && (status.matchPhase === 'service' || status.matchPhase === 'final_rush') ? (
        <FrontDoorBoard status={status} onActivate={(id) => clientRef.current?.activateSpecial(id)} />
      ) : null}
      {/* STORY-015 §8 "Tab: tactical overview panel". Toggled by `InputController
          #onToggleOverview`; `GameClient` already force-closes this (`showTacticalOverview:
          false`) on leaving `service`/`final_rush`, so the phase check here is a display guard,
          not the only thing preventing a stale panel. */}
      {status?.showTacticalOverview && (status.matchPhase === 'service' || status.matchPhase === 'final_rush') ? (
        <TacticalOverviewPanel status={status} />
      ) : null}
      {status?.matchPhase === 'lobby' ? (
        <div className="scope-note">
          <strong>Open for business</strong> — ready up, choose your menu and staffing,
          then help your crew seat customers, cook and deliver orders.
        </div>
      ) : null}
      <div className="help">
        <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move · <kbd>Shift</kbd> sprint ·{' '}
        <kbd>E</kbd> interact · <kbd>F</kbd> put down · <kbd>Tab</kbd> overview
      </div>
      {/* PRD §8 "contextual prompt": InteractionController resolved a target within range and
          this is it, verbatim — nothing here decides whether pressing E will succeed. */}
      {status?.prompt ? (
        <div className="interact-prompt">
          <kbd>E</kbd>
          {status.prompt.label}
        </div>
      ) : null}
      {status && (status.carrying.length > 0 || status.currentAction) ? (
        <div className="carry-status">
          {status.currentAction ? `${status.currentAction}…` : null}
          {status.currentAction && status.carrying.length > 0 ? ' · ' : null}
          {status.carrying.length > 0 ? `carrying ${status.carrying.length}` : null}
        </div>
      ) : null}
    </div>
  );
}
