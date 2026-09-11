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
import { ServiceStationBoard } from '../ui/ServiceStationBoard';
import { PantryBoard } from '../ui/PantryBoard';
import { KitchenCommandBoard } from '../ui/KitchenCommandBoard';
import { KitchenQueueBoard } from '../ui/KitchenQueueBoard';
import { StationMenu } from '../ui/StationMenu';
import type { InviteInfo } from '../ui/InvitePanel';
import { navigate } from './router';

/** STORY-034. Long enough to read "Connection lost" and why, short enough that sitting on a
 * dead-end screen doesn't feel stuck. `ReconnectOverlay`'s own Skip button bypasses this for
 * anyone who doesn't want to wait either way. */
const RECONNECT_TERMINAL_AUTO_MENU_SECONDS = 5;

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

  // STORY-034. Safety net for the "Peek" button's hold: `onPointerUp`/`onPointerLeave` on the
  // button itself miss the case where the pointer is released or the tab loses focus AFTER
  // leaving the button (e.g. a drag, or alt-tabbing mid-hold) — left unhandled, `peeking` would
  // stick `true` with no way to release it short of pressing and re-releasing the button, which
  // requires seeing the button, which requires the very floor `peeking: true` hides. A blanket
  // release on any of these window-level events is harmless when already false.
  useEffect(() => {
    const release = () => clientRef.current?.setPeeking(false);
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      window.removeEventListener('blur', release);
    };
  }, []);

  // STORY-034. `disconnectedTerminal` (ReconnectOverlay's own doc comment above) is a dead end —
  // this client's own socket is already closed and nothing further will arrive on it — so
  // sitting on it forever with only a manual "Reload" was a dead click for anyone who didn't
  // notice it. Auto-return to the menu a few seconds later, long enough to actually read why,
  // with a Skip button (rendered by ReconnectOverlay) for anyone who doesn't want to wait.
  const [autoMenuSecondsLeft, setAutoMenuSecondsLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!status?.disconnectedTerminal) {
      setAutoMenuSecondsLeft(null);
      return undefined;
    }
    setAutoMenuSecondsLeft(RECONNECT_TERMINAL_AUTO_MENU_SECONDS);
    const interval = window.setInterval(() => {
      setAutoMenuSecondsLeft((seconds) => {
        if (seconds === null || seconds <= 1) {
          navigate('/');
          return 0;
        }
        return seconds - 1;
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [status?.disconnectedTerminal]);

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
      {status?.serviceStationNotice ? <div className="service-station-confirmation" role="status">{status.serviceStationNotice}</div> : null}
      {/* See `SceneManager`'s own comment on `webglcontextlost` — not full-bleed like
          `ReconnectOverlay` below: the match/socket is unaffected, and the browser usually
          restores the context within a frame or two, so blocking the whole screen for what's
          often a sub-second GPU hiccup would be worse than the small banner it replaces. */}
      {status?.graphicsContextLost ? (
        <div className="graphics-context-banner" role="status">
          Graphics reconnecting…
        </div>
      ) : null}
      <HudPanel status={status} onReady={(ready) => clientRef.current?.setReady(ready)} />
      {/* STORY-034. Reported: the two restaurants share one camera frame but the rival's floor
          is only ever a small, distant sliver — hold this to swing the SAME camera over to it
          (`GameClient#setPeeking`'s own comment on why a hold, not a toggle). Gated to service/
          final_rush like every other interactive HUD element here: before service there is no
          rival floor populated yet worth looking at. */}
      {status && (status.matchPhase === 'service' || status.matchPhase === 'final_rush') ? (
        <button
          type="button"
          className={`peek-button${status.peeking ? ' peek-button--active' : ''}`}
          onPointerDown={() => clientRef.current?.setPeeking(true)}
          onPointerUp={() => clientRef.current?.setPeeking(false)}
          onPointerLeave={() => clientRef.current?.setPeeking(false)}
          onPointerCancel={() => clientRef.current?.setPeeking(false)}
        >
          👀 Peek at rival <kbd>Q</kbd>
        </button>
      ) : null}
      {/* STORY-022. Highest z-index in the sheet (see app.css) — every panel above and below
          this one is reading `status`, which stops updating the instant the socket drops, so
          nothing here needs its own gating besides the two fields this overlay itself owns. */}
      <ReconnectOverlay
        reconnecting={Boolean(status?.reconnecting)}
        disconnectedTerminal={status?.disconnectedTerminal ?? null}
        autoMenuSecondsLeft={autoMenuSecondsLeft}
        onSkip={() => navigate('/')}
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
          sharedRestaurant={status.sharedRestaurant}
          onBuy={(upgradeId) => clientRef.current?.buyUpgrade(upgradeId)}
        />
      ) : null}
      {status?.nearHostStand && status.showFrontDoorBoard && (status.matchPhase === 'service' || status.matchPhase === 'final_rush') ? (
        <FrontDoorBoard
          status={status}
          onActivate={(id) => clientRef.current?.activateSpecial(id)}
          onSeat={() => clientRef.current?.seatWaitingParty()}
        />
      ) : null}
      {status?.nearServiceStation && status.showServiceStationBoard && (status.matchPhase === 'service' || status.matchPhase === 'final_rush') ? (
        <ServiceStationBoard status={status} onCommand={(command) => clientRef.current?.serviceStationCommand(command)} />
      ) : null}
      {status?.nearPantry && status.showPantryBoard && (status.matchPhase === 'service' || status.matchPhase === 'final_rush') ? (
        <PantryBoard
          status={status}
          onOrder={(productId, ingredientId) => clientRef.current?.placePantryOrder(productId, ingredientId)}
          onMoveToKitchen={() => clientRef.current?.restockKitchen()}
        />
      ) : null}
      {status?.nearKitchenCommandBoard && status.showKitchenCommandBoard && (status.matchPhase === 'service' || status.matchPhase === 'final_rush') ? (
        <KitchenCommandBoard status={status} onFocus={(focusId) => clientRef.current?.kitchenFocusCommand(focusId)} />
      ) : null}
      {/* STORY-043. Renders in every mode (Decision 72 in this story's own `design.md`) — not
          gated on `sharedRestaurant` like `StationMenu` below, since a staffed match's board is
          still a truthful, harmless read of PRD §17 rules 2/3, just not the ONLY thing directing
          play there the way it is in co-op. */}
      {status?.nearKitchenOrderQueueBoard && status.showKitchenOrderQueueBoard && (status.matchPhase === 'service' || status.matchPhase === 'final_rush') ? (
        <KitchenQueueBoard status={status} />
      ) : null}
      {/* STORY-042 AC4: co-op only (`sharedRestaurant`) — a non-co-op match keeps its
          single-tap `E — Cook X`/`E — Plate X` prompt below (`status?.prompt`) untouched, since
          `nearStation` is computed unconditionally but only rendered here under this extra
          gate. Phase-gated like the boards above it, not like `UpgradeTerminal` (which has no
          phase gate) — `cook`/`plate` itself is `service`/`final_rush`-only
          (`action-validator.js`'s `INTERACT_PHASES`), so this panel would otherwise offer a
          menu whose one action is guaranteed to be rejected outside those phases. */}
      {status?.nearStation && status.sharedRestaurant && (status.matchPhase === 'service' || status.matchPhase === 'final_rush') ? (
        <StationMenu status={status} station={status.nearStation} onSelect={(station) => clientRef.current?.cookOrPlateAt(station)} />
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
        <kbd>E</kbd> interact
        {/* `F`/`drop_carry` only does anything while carrying an order (it un-claims it back to
            the pass, not a delivery shortcut — see `action-validator.js#resolveDropCarry`), so
            advertising it at all times read as "there's a second key you need for pickup/
            dropoff" when there isn't: `E` alone drives both `pickup` and `deliver`, already the
            same key, just two different `InteractionPrompt.action` values depending on whether
            you're at the pass or at the right table. Only surfacing `F` while it's actually live
            removes that false impression. */}
        {status && status.carrying.length > 0 ? <> · <kbd>F</kbd> return dish</> : null} ·{' '}
        <kbd>Tab</kbd> overview · <kbd>Q</kbd> peek
      </div>
      {/* PRD §8 "contextual prompt": InteractionController resolved a target within range and
          this is it, verbatim — nothing here decides whether pressing E will succeed. `deliver`
          gets its own louder styling (`.interact-prompt--deliver`): it's the one prompt that
          only appears while already carrying something, i.e. the exact "you're standing where
          it goes, hit E" moment — see `app.css`'s own comment on that class for why it needed
          to be visually unmistakable rather than identical to every other contextual hint. */}
      {status?.nearPantry && (status.matchPhase === 'service' || status.matchPhase === 'final_rush') ? (
        <div className="interact-prompt"><kbd>E</kbd>Manage Pantry</div>
      ) : status?.nearKitchenCommandBoard && (status.matchPhase === 'service' || status.matchPhase === 'final_rush') ? (
        <div className="interact-prompt"><kbd>E</kbd>Direct Kitchen</div>
      ) : status?.nearKitchenOrderQueueBoard && (status.matchPhase === 'service' || status.matchPhase === 'final_rush') ? (
        <div className="interact-prompt"><kbd>E</kbd>Read Order Queue</div>
      ) : status?.nearServiceStation && (status.matchPhase === 'service' || status.matchPhase === 'final_rush') ? (
        <div className="interact-prompt"><kbd>E</kbd>Manage Dining Room</div>
      ) : status?.nearHostStand && (status.matchPhase === 'service' || status.matchPhase === 'final_rush') ? (
        <div className="interact-prompt">
          <kbd>E</kbd>
          Manage Front Door
        </div>
      ) : status?.prompt ? (
        <div className={`interact-prompt${status.prompt.action === 'deliver' ? ' interact-prompt--deliver' : ''}`}>
          <kbd>E</kbd>
          {status.prompt.action === 'deliver' ? status.prompt.label.toUpperCase() : status.prompt.label}
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
