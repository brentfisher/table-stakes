// Wires transport, input, interpolation, and scene together. This is the single object the
// React shell creates and disposes; React never reaches past it into the scene graph.

import { NetworkClient, type ServerMessage } from './NetworkClient';
import { InputController } from './InputController';
import { StateInterpolator, type PlayerState } from './StateInterpolator';
import { EntityViewRegistry } from './EntityViewRegistry';
import { SceneManager } from './SceneManager';
import { InteractionController, type InteractionPrompt } from './InteractionController';
import { DEFAULT_CAMERA, PEEK_CAMERA } from './CameraController';
import { PEEK_CAMERA_TARGET_Z } from '../../../shared/constants/tuning';
import type {
  BotSnapshotEntry,
  CustomerSnapshot,
  KitchenQueueBoardEntry,
  MatchCompleteMessage,
  MatchResult,
  ManagerLedgerSnapshot,
  MatchEndReason,
  MatchPhase,
  OrderSnapshot,
  PantrySnapshot,
  PublicMarket,
  RestaurantSnapshot,
  SnapshotEventEntry,
  SnapshotEventForecastEntry,
} from '../../../shared/schemas/messages';
// STORY-016. `CustomerRenderState`/`WorkerRenderState` are the narrow shapes
// `RestaurantScene.ts`'s own `upsertCustomer`/`upsertWorker` accept — see that file's own
// header on why `WorkerRenderState` is extracted from `RestaurantSnapshot['workers']` rather
// than redeclared.
import type {
  CustomerRenderState,
  QueueBoardDishRenderState,
  ReadyDishRenderState,
  WorkerRenderState,
} from '../scenes/RestaurantScene';
import type { AcceptedSetup } from '../../../shared/schemas/setup-rules';
import upgradesData from '../../../shared/game-data/upgrades.json';
import kitchenCommandData from '../../../shared/game-data/kitchen-command.json';
// STORY-015. `shared/game-logic/hud-alerts.js` (plain JS + sibling `.d.ts`, Decision 4's shape)
// is the ONE place PRD §18's alert priority order and alarm-fatigue cap are implemented — the
// same module `scripts/check-hud.mjs` imports directly, so the ranking this HUD shows and the
// ranking the check chain verifies can never quietly diverge. See that file's own header for
// why the server (`activeBottlenecks`) always decides WHETHER a category fires and this client
// only ever picks out WHICH entity earns the alert text.
import { buildCriticalAlerts, capCriticalAlerts, type CriticalAlert } from '../../../shared/game-logic/hud-alerts';
// STORY-015. See that file's own header for why `cashFeedbackFor` — the "is this a major
// moment" decision, including the null-revenue first-sample guard — is pulled out as its own
// pure, dual-imported (client + check script) function rather than left inline here.
import { cashFeedbackFor } from '../../../shared/game-logic/hud-cash-feedback';
// STORY-044. See that file's own header: the one predicate deciding whether a customer snapshot
// belongs on THIS viewer's floor, dual-imported by `scripts/check-district-population.mjs` so
// this filter and that check can never quietly diverge.
import { shouldRenderCustomerForViewer } from '../../../shared/game-logic/district-population';
// STORY-029. PRD-027 §9 "Presentation Event Reducer" — the ONE place a `match_snapshot` diff
// turns into deduplicated, stably-keyed `PresentationEvent`s for the arcade toast layer
// (`client/src/ui/ArcadeToast.tsx`). Same Decision 4 shape/dual-import reasoning as
// `hud-alerts.js` above: `scripts/check-presentation-events.mjs` imports the identical module.
import {
  reducePresentationEvents,
  type EmittedPresentationEvent,
  type PresentationSnapshotInput,
} from '../../../shared/game-logic/presentation-event-reducer';
import {
  HUD_CRITICAL_ALERTS_MAX,
  HUD_CASH_FEEDBACK_MIN_DELTA,
  HUD_CASH_FEEDBACK_DISPLAY_MS,
  RECONNECT_GRACE_MS,
} from '../../../shared/constants/tuning';

/** Shared empty-array reference — `handleMessage` reuses THIS exact array whenever a snapshot
 * diff emits nothing new, rather than allocating a fresh `[]`, so `ArcadeToast.tsx`'s queue
 * effect (keyed on array identity) does not re-run at snapshot cadence (~10 Hz) for no reason. */
const EMPTY_PRESENTATION_EVENTS: EmittedPresentationEvent[] = [];

/** STORY-022. How often a dropped client retries the socket while `reconnecting` is shown. */
const RECONNECT_RETRY_INTERVAL_MS = 1500;
/** Slack past the server's own grace window before the client gives up unprompted — the server
 * is the authority on when the seat is actually gone; this only covers "we cannot even reach it
 * to find out", which the grace window alone would cut off right at the boundary. */
const RECONNECT_GIVE_UP_BUFFER_MS = 5_000;

interface UpgradeInfo {
  id: string;
  cost: number;
  requires?: string;
}
const UPGRADE_BY_ID = new Map<string, UpgradeInfo>(
  (upgradesData.upgrades as UpgradeInfo[]).map((u) => [u.id, u]),
);
/** STORY-012 / STORY-035. These catalogue entries have a live effect hook — see
 * `server/src/game/systems/upgrade-system.js`'s `KNOWN_EFFECT_KEYS`. The affordability
 * indicator and the terminal overlay both restrict to this list; the remaining entries are legal
 * catalogue data with nothing yet reading them. */
export const WIRED_UPGRADE_IDS = [
  'serving_tray_1',
  'serving_tray_2',
  'faster_grill_1',
  'better_seating_1',
  'pantry_shelves_1',
  'host_stand_toolkit_1',
  'street_signage_1',
  'queue_pager_1',
  'guest_recovery_kit_1',
  'maitre_d_radio_1',
  'window_display_1',
];
export const FRONT_DOOR_UPGRADE_IDS = [
  'host_stand_toolkit_1',
  'street_signage_1',
  'queue_pager_1',
  'guest_recovery_kit_1',
  'maitre_d_radio_1',
  'window_display_1',
];
/**
 * STORY-040. The audited subset of `WIRED_UPGRADE_IDS` whose effect ONLY matters with automated
 * staff on the roster. `maitre_d_radio_1`'s `serverSeatingDurationMultiplier` is read in exactly
 * one place, `worker-system.js`'s automated seat-party task duration (`selectServerTask`/
 * `selectHostTask`) — never by the owner's own manual "Seat Party" interact
 * (`action-validator.js#resolveSeat` calls `match.floor.seatParty` directly, no worker-style
 * duration at all). In a co-op restaurant (`worker-system.js#buildStaff`'s `workers: []`) that
 * multiplier is applied to a worker that will never exist — a legal, harmless, but completely
 * dead purchase. Every OTHER `WIRED_UPGRADE_IDS` entry was checked against its own read site and
 * found to help the PLAYER directly regardless of who is cooking/seating/serving (station speed
 * and concurrency are equipment, not hands; patience/queue/recovery/front-door multipliers are
 * customer- or player-triggered, not worker-gated; `restockTravelTimeMultiplier` scales the same
 * pantry trip the owner's own manual restock takes, per `inventory-system.js#restockDurationMs`'s
 * own comment), so none of them are locked here.
 *
 * FUTURE-PROOFING: `server_radio_1`'s `serverTargetingQuality` ("the server picks better targets
 * and wastes fewer trips") is, by its own description, exactly as staff-only as
 * `maitre_d_radio_1` — but it has no live read site yet (`upgrade-system.js#KNOWN_EFFECT_KEYS`
 * does not name its effect key), so `WIRED_UPGRADE_IDS` already excludes it from the terminal
 * and there is nothing for this list to lock. Whoever wires that effect should add its id here
 * in the SAME change, not leave it as a follow-up.
 */
export const STAFF_ONLY_UPGRADE_IDS = ['maitre_d_radio_1'];

/** What the §18 setup screen sends. PRD §12 client-to-server example 4, plus §7's extras. */
export interface SetupSubmitPayload {
  menu: Array<{ dishId: string; price: number }>;
  addons: Array<{ dishId: string; price: number }>;
  startingUpgradeId: string | null;
  staffAssignments: Record<string, string>;
  startingInventory: Record<string, number>;
  policyId: string | null;
  policyDishId: string | null;
}

/**
 * Everything the React HUD renders. `matchPhase` and `timeRemainingMs` are copied straight
 * out of the last snapshot and are NEVER extrapolated locally: PRD §12 gives the server the
 * match timer (Milestone 0 Decision 2), and a client that counts down on its own is a client
 * that disagrees with the server about when service ends. Snapshots arrive at BROADCAST_HZ,
 * which is a smooth enough countdown for a HUD.
 */

/** STORY-024. See `GameClientStatus.players`'s own comment. */
export interface LobbySlot {
  playerId: string;
  connected: boolean;
  ready: boolean;
}

export interface GameClientStatus {
  connection: 'connecting' | 'open' | 'closed';
  roomId: string | null;
  playerId: string | null;
  /**
   * STORY-039. Which restaurant THIS viewer belongs to — straight off `you.restaurantId`.
   * Identical to `playerId` in every pre-existing mode (dev/private_human/solo_bot), so every
   * PRE-EXISTING comparison against `playerId` for "is this restaurants[]/orders[]/customers[]
   * entry mine" is unaffected by leaving it alone; NEW code should read THIS instead, since a
   * co-op guest's `playerId` is never a key into any of those restaurant-keyed structures. Null
   * before the first `match_snapshot` arrives, same as `playerId`.
   */
  restaurantId: string | null;
  /**
   * STORY-040. Straight off the wire's top-level `sharedRestaurant` — `Match#sharedRestaurant`,
   * public and identical for both co-op seats (see `match.js#toSnapshot`'s own comment on why
   * this is not under `you`). `false` before the first `match_snapshot` arrives and for every
   * pre-existing mode. Drives the ready-up flow's empty staff assignments and the upgrade
   * terminal's staff-only lock.
   */
  sharedRestaurant: boolean;
  seed: string | null;
  playerCount: number;
  serverTime: number;
  matchPhase: MatchPhase | null;
  timeRemainingMs: number | null;
  market: PublicMarket | null;
  ready: boolean;
  /**
   * The viewer's OWN accepted setup submission, straight out of `you.setup`. There is no
   * opponent equivalent and there must never be one: PRD §18 forbids revealing the rival's
   * menu or prices during setup, and the server simply does not send them (Decision 16).
   */
  setup: AcceptedSetup | null;
  /** PRD §18 "opponent-ready status" — the one public fact about the rival's setup. */
  opponentReady: boolean;
  /** The last `setup_rejected` the server sent, cleared on the next accepted submission. */
  setupRejection: { reason: string; detail: string } | null;
  /** Set once `match_complete` arrives; the match is over. */
  endReason: MatchEndReason | null;
  /**
   * STORY-014. The rest of `match_complete`, verbatim — the results screen's ENTIRE data
   * source (PRD §11's results screen AC: "nothing is recomputed client-side"). `winnerPlayerId`
   * is null on both a genuine draw and the not-yet-arrived state; `ResultsPanel` distinguishes
   * them by checking `matchComplete !== null`, not by `winnerPlayerId`.
   */
  matchComplete: MatchCompleteMessage | null;
  /**
   * STORY-052. The viewer's own final `MatchResult`, straight off the private
   * `you.resultsPreview` — available from the very first `results`-phase snapshot, well before
   * `matchComplete` arrives. `RecapTeaser` is the one consumer: it renders a building sequence
   * of facts from this while `matchComplete` is still null, then gets out of the way (see
   * `matchComplete`'s own comment — `ResultsPanel` is the sole reader once that arrives). Null
   * before `results`, and also null on the disconnect-end path where `matchComplete` follows
   * immediately anyway — see `match.js#toSnapshot`'s own comment on `you.resultsPreview`.
   */
  resultsPreview: MatchResult | null;
  /**
   * STORY-008 §8 "contextual interact prompt" — `InteractionController`'s current pick, or
   * null with nothing in range. Recomputed every render frame from interpolated position but
   * only patched into status on CHANGE, so the HUD does not re-render at frame rate.
   */
  prompt: InteractionPrompt | null;
  /** STORY-008. Order ids the owner is carrying, straight off `players[].carrying`. */
  carrying: string[];
  /** STORY-008. The in-progress `interact` action, or null — `players[].currentAction`. */
  currentAction: string | null;
  /** STORY-012. Starting cash plus revenue earned so far, minus every upgrade bought —
   * straight off the private `you.cash`. Null before `service` (before upgrades exist). */
  cash: number | null;
  /** STORY-012. This restaurant's own owned upgrade ids, straight off `you.purchasedUpgradeIds`. */
  purchasedUpgradeIds: string[];
  /** STORY-012. Whether the owner is close enough to browse the upgrade terminal — drives
   * whether `UpgradeTerminal`'s shop overlay renders. Recomputed every frame, patched on
   * change, same discipline as `prompt`. */
  nearUpgradeTerminal: boolean;
  /** STORY-032. Drives the read-only front-door board while the owner is at the host stand. */
  nearHostStand: boolean;
  showFrontDoorBoard: boolean;
  frontDoor: Record<string, { activeSpecialId: string | null; featuredDishId: string | null; activeForMs: number; cooldownForMs: number; eligibleSpecialIds: string[] }>;
  nearServiceStation: boolean;
  showServiceStationBoard: boolean;
  serviceStationNotice: string | null;
  serviceStation: Record<string, { priorityId: string; priorityCooldownForMs: number; payrollBurn: number; laborExpenses: number; contracts: Array<{ contractId: string; workerId: string; status: 'arriving' | 'active'; arrivalForMs: number; activeForMs: number; committedForMs: number }> }>;
  nearPantry: boolean;
  showPantryBoard: boolean;
  pantry: PantrySnapshot | null;
  nearKitchenCommandBoard: boolean;
  showKitchenCommandBoard: boolean;
  /** STORY-043. Same proximity/toggle pair as `nearKitchenCommandBoard`/`showKitchenCommandBoard`
   * just above, for the SECOND, distinct board this story adds — see `KitchenQueueBoard.tsx`'s
   * own header on why it is a separate entity/panel, not a mode of the existing one. */
  nearKitchenOrderQueueBoard: boolean;
  showKitchenOrderQueueBoard: boolean;
  /**
   * STORY-043. This restaurant's own outstanding tickets, every station, already ranked by
   * `worker-system.js#compareTickets` — straight off the private `you.kitchenQueueBoard`. `[]`,
   * not null, before `match.kitchen` exists — see that wire field's own `.d.ts` comment.
   */
  kitchenQueueBoard: KitchenQueueBoardEntry[];
  /**
   * STORY-042. Which station (`'prep' | 'grill' | 'oven' | 'plating'`), by name, the owner is
   * close enough to browse a "what to cook here" menu for, or null — straight off
   * `InteractionController#nearStation`, same per-frame/patch-on-change discipline as
   * `nearUpgradeTerminal`. Rendering `StationMenu` on this ALSO requires `sharedRestaurant`
   * (AC4: co-op only) — that gate lives in `GameView.tsx`, not here, so this field stays a
   * plain proximity read usable by any future non-co-op consumer too.
   */
  nearStation: string | null;
  /** STORY-034. Reported: "the two restaurants read as on top of each other" — both floors
   * already share one camera frame (PRD's "rival activity visible" requirement), but the
   * camera's normal narrow pan range (`handleFrame`'s own `setTarget` call) stays centered on
   * the owner, so the rival's floor is only ever a small, distant sliver of the shot. `setPeeking`
   * swings the SAME camera to the shared district instead while held — see that method's own
   * comment on why this is a hold, not a toggle. STORY-045 widened what "held" actually shows
   * (a second, pulled-back `CameraSettings` profile plus a retargeted `setTarget`, both in
   * `setPeeking`/`handleFrame`) so the district street STORY-044 populates is visible too, not
   * only the rival floor. */
  peeking: boolean;
  kitchenCommand: {
    activeFocusId: string;
    cooldownForMs: number;
    selectionsByFocus: Record<string, number>;
    stationQueues: Array<{ station: string; queued: number }>;
    oldestReadyFoodMs: number;
    shortages: Array<{ station: string; ingredientId: string; blockedTickets: number; restocking: boolean; exhausted: boolean }>;
    menuAvailability: Array<{ dishId: string; available: boolean }>;
    activeEventIds: string[];
    activeSpecialId: string | null;
    atRiskGuests: number;
    recommendation: { focusId: string; reason: string };
  } | null;
  /** STORY-037. Server-authored command chips and five-constraint diagnosis. */
  managerLedger: ManagerLedgerSnapshot | null;
  /**
   * STORY-012 AC: "shows an upgrade-availability indicator ... without forcing a trip to
   * check." True when at least one of `WIRED_UPGRADE_IDS` is unowned, has its `requires` (if
   * any) already owned, and costs no more than `cash` — computed from public catalogue data,
   * not duplicated server-side.
   */
  canAffordUpgrade: boolean;
  /** STORY-015. Which affordable upgrade `canAffordUpgrade` found, first in `WIRED_UPGRADE_IDS`
   * order — lets the HUD's priority-6 "upgrade available" alert name the upgrade instead of
   * just flagging that one exists. Null exactly when `canAffordUpgrade` is false. */
  affordableUpgradeId: string | null;
  /**
   * STORY-015. PRD §18 "Revenue and available cash" — straight off the private `you.revenue`
   * (see `match.js#toSnapshot`'s own comment on why it lives under `you`, same as `cash`).
   * Null before `service`, same as `cash`.
   */
  revenue: number | null;
  /** STORY-015. `match_snapshot.restaurants[]`, verbatim — the HUD's own restaurant AND the
   * compact rival summary both read out of this one array; nothing here is recomputed. */
  restaurants: RestaurantSnapshot[];
  /** STORY-015. `match_snapshot.customers[]`, verbatim — the source for the "customer
   * abandonment imminent" alert's specifics (which party, how much patience is left). */
  customers: CustomerSnapshot[];
  /** STORY-015. `match_snapshot.orders[]`, verbatim — the source for "food ready but
   * undelivered" and for cross-referencing `carrying`'s dish name(s), per `PlayerSnapshot
   * .carrying`'s own field comment. */
  orders: OrderSnapshot[];
  /** STORY-015. `match_snapshot.events[]`, verbatim — "current active event" and the
   * "event countdown" alert both read this directly; see `event-system.js`'s own header. */
  events: SnapshotEventEntry[];
  /** STORY-015. `match_snapshot.eventForecast[]`, verbatim — PRD §18 "upcoming event warning". */
  eventForecast: SnapshotEventForecastEntry[];
  /**
   * STORY-015. PRD §18 "Critical alerts", already ranked in §18 priority order AND capped to
   * `HUD_CRITICAL_ALERTS_MAX` — see `shared/game-logic/hud-alerts.js`. Computed once per
   * snapshot here, not in the render tree, so `HudPanel` only ever maps over an already-final
   * list; this is what makes "updates at panel cadence, not per frame" true for the alert list
   * specifically, the same way `prompt`'s patch-on-change discipline makes it true for the
   * contextual prompt.
   */
  criticalAlerts: CriticalAlert[];
  /**
   * STORY-015. PRD §14 "Floating cash/tip feedback only for major moments, not every
   * transaction". Set for `HUD_CASH_FEEDBACK_DISPLAY_MS` when `revenue` jumps by at least
   * `HUD_CASH_FEEDBACK_MIN_DELTA` between two snapshots, then cleared — see
   * `handleMessage`'s own comment on the guard against firing on the FIRST real value.
   */
  cashFeedback: { amount: number; atMs: number } | null;
  /**
   * STORY-029. PRD-027 §9 — the batch of `PresentationEvent`s (with their §9 dedup key) THIS
   * snapshot's diff freshly emitted, already deduplicated against every key emitted so far this
   * match. Almost always empty: `reducePresentationEvents` only returns something on an actual
   * state transition (a ticket becoming ready, an event changing state), never on a steady-state
   * repeat. `ArcadeToast.tsx` is the one consumer; it owns turning this into "which one toast is
   * visible right now" (ranking, interruption, coalescing) — this field is just the raw diff
   * output, at snapshot cadence, same discipline `criticalAlerts` above already established.
   */
  presentationEvents: EmittedPresentationEvent[];
  /** STORY-015. PRD §8 `Tab`: the tactical overview panel — see `InputController
   * #tacticalOverviewEnabled`'s own comment on why it is only reachable during
   * `service`/`final_rush`. */
  showTacticalOverview: boolean;
  /** STORY-022. True from the moment an already-joined client's socket drops until it either
   * reopens and rejoins, or reconnection is given up (see `disconnectedTerminal`). Never true
   * before the FIRST successful join — see `handleConnectionChange`'s own guard. */
  reconnecting: boolean;
  /** True between `SceneManager`'s `webglcontextlost` and `webglcontextrestored` — see that
   * file's own comment on why this can happen mid-match with no user action at fault. The
   * websocket connection is unaffected (this is a GPU/browser-level event, not a network one),
   * so `reconnecting` above stays false the whole time; this is a separate signal. */
  graphicsContextLost: boolean;
  /**
   * STORY-024. `match_snapshot.players[]`, narrowed to what `LobbyScreen` needs — a slot's
   * identity, connection, and ready state — and NOTHING position/scene-related (that half of
   * `players[]` already flows straight into `StateInterpolator`/`EntityViewRegistry` in
   * `handleMessage` below, never through React). Public for both seats, same as `ready` already
   * is on the wire (PRD §18 "opponent-ready status") — there is nothing private about a slot
   * being connected or ready.
   */
  players: LobbySlot[];
  /** STORY-022. Set once reconnection is given up: either the server answered a rejoin attempt
   * with `error: 'match_ended'`/`'room_not_found'`, or the client could not reopen a socket at
   * all within `RECONNECT_GRACE_MS + RECONNECT_GIVE_UP_BUFFER_MS`. Null while still connected or
   * still retrying. `reason` is a MatchEndReason, `'room_not_found'`, or `'unreachable'`. */
  disconnectedTerminal: { reason: string } | null;
  /** STORY-025. `match_snapshot.bots[]`, verbatim — empty for a human-vs-human match. This is
   * what lets `HudPanel`/`TacticalOverviewPanel`/`ResultsPanel` name a bot opponent by profile
   * (`bot-profiles.ts#botProfileLabel`) instead of a generic "Rival", without any of them
   * re-deriving "is this seat a bot" from anything but this array. */
  bots: BotSnapshotEntry[];
}

/** STORY-012 AC / STORY-015: the ambient "something is worth buying" signal, computed from
 * public catalogue data — never a second copy of `action-validator.js#handlePurchaseUpgrade`'s
 * own legality checks, just the subset a HUD indicator (and now the priority-6 alert) needs
 * (unaffordable/owned/locked all read the same). Returns the first affordable id in
 * `WIRED_UPGRADE_IDS` order, or null — `canAffordUpgrade` is simply `!== null` on the result. */
function pickAffordableUpgrade(cash: number | null, owned: string[]): string | null {
  if (cash === null) return null;
  return (
    WIRED_UPGRADE_IDS.find((id) => {
      if (owned.includes(id)) return false;
      const upgrade = UPGRADE_BY_ID.get(id);
      if (!upgrade) return false;
      if (upgrade.requires && !owned.includes(upgrade.requires)) return false;
      return upgrade.cost <= cash;
    }) ?? null
  );
}

const INPUT_SEND_HZ = 20;

export class GameClient {
  private readonly network = new NetworkClient();
  private readonly input: InputController;
  private readonly interpolator = new StateInterpolator();
  private readonly registry = new EntityViewRegistry();
  private readonly scene: SceneManager;
  private readonly interaction = new InteractionController();

  private sinceInputSend = 0;
  /** STORY-016. Accumulated seconds, fed to `RestaurantScene#updateCustomerAnimations` every
   * render frame — Three.js-side timing only, never read by React (Notable Pattern 3/11). */
  private elapsedSeconds = 0;
  private status: GameClientStatus = {
    connection: 'closed',
    roomId: null,
    playerId: null,
    restaurantId: null,
    sharedRestaurant: false,
    seed: null,
    playerCount: 0,
    serverTime: 0,
    matchPhase: null,
    timeRemainingMs: null,
    market: null,
    ready: false,
    setup: null,
    opponentReady: false,
    setupRejection: null,
    endReason: null,
    matchComplete: null,
    resultsPreview: null,
    prompt: null,
    carrying: [],
    currentAction: null,
    cash: null,
    purchasedUpgradeIds: [],
    nearUpgradeTerminal: false,
    nearHostStand: false,
    showFrontDoorBoard: false,
    frontDoor: {},
    nearServiceStation: false,
    showServiceStationBoard: false,
    serviceStationNotice: null,
    serviceStation: {},
    nearPantry: false,
    showPantryBoard: false,
    pantry: null,
    nearKitchenCommandBoard: false,
    showKitchenCommandBoard: false,
    nearKitchenOrderQueueBoard: false,
    showKitchenOrderQueueBoard: false,
    kitchenQueueBoard: [],
    nearStation: null,
    peeking: false,
    kitchenCommand: null,
    managerLedger: null,
    canAffordUpgrade: false,
    affordableUpgradeId: null,
    revenue: null,
    restaurants: [],
    customers: [],
    orders: [],
    events: [],
    eventForecast: [],
    criticalAlerts: [],
    cashFeedback: null,
    presentationEvents: EMPTY_PRESENTATION_EVENTS,
    showTacticalOverview: false,
    reconnecting: false,
    graphicsContextLost: false,
    disconnectedTerminal: null,
    players: [],
    bots: [],
  };

  /** STORY-024. Set by `start()`; resent on every `join_room` (see `NetworkClient.joinRoom`'s
   * own comment on why sending it during a reconnect, too, is harmless). Undefined for every
   * pre-existing dev/bot flow, which never passes a second argument to `start()`. */
  private inviteToken: string | undefined;

  /** STORY-029. `reducePresentationEvents`'s own "previous" argument — null until the first real
   * `match_snapshot` has been diffed once, so the very first snapshot never gets read as a wall
   * of transitions (see that function's own first-value guard). Advanced to this snapshot's
   * input at the end of every `match_snapshot` branch. */
  private previousPresentationSnapshot: PresentationSnapshotInput | null = null;
  /** STORY-029. Every §9 key `reducePresentationEvents` has ever returned this match — the ONE
   * piece of state that makes "never re-emit a key" true across snapshots; the reducer itself is
   * pure and only ever reads this set, never owns it. */
  private readonly emittedPresentationEventKeys = new Set<string>();

  private cashFeedbackTimeout: ReturnType<typeof setTimeout> | null = null;
  private serviceStationNoticeTimeout: ReturnType<typeof setTimeout> | null = null;
  /** STORY-022. Cleared in `dispose()` so a pending retry never fires after teardown. */
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** STORY-022. Set on the FIRST unexpected drop, cleared on a successful reopen. Compared
   * against `Date.now()`, not `elapsedMs` — this measures wall-clock retry patience on a
   * connection that, by definition, has no server clock to read right now. */
  private reconnectDeadlineMs: number | null = null;
  /** STORY-022. Guards `handleConnectionChange` against the 'closed' event `dispose()`'s own
   * `network.disconnect()` call triggers — a deliberate teardown must never start a retry loop. */
  private disposed = false;

  /**
   * STORY-031. The `action` half of the most recently SENT `interact` — `onInteract`'s send site
   * sets this right before calling `network.sendInteract`. The server's `interact_rejected` error
   * (message-router.js#handleInteract) carries no `action`/`targetId` of its own (only `error`/
   * `reason`/`detail`), so this is how the `error` handler below knows a given rejection was for
   * a `deliver` attempt specifically — the only kind this story's AC asks for negative feedback
   * on. Safe against interleaving: the server rejects `interact` while a PREVIOUS one is still
   * `busy` (`action-validator.js`'s own `busy` reason), so there is never more than one
   * outstanding `interact` per player to misattribute this to.
   */
  private lastInteractAction: string | null = null;

  /** Called at panel cadence, not per frame — React subscribes here. */
  onStatus: ((status: GameClientStatus) => void) | null = null;

  constructor(container: HTMLElement) {
    this.scene = new SceneManager(container);
    // Keep the authored restaurant isolated until the player explicitly holds Peek.
    this.scene.restaurant.setCompetitorVisible(false);
    this.input = new InputController(window);

    this.registry.register<PlayerState>('players', {
      upsert: (state) =>
        this.scene.restaurant.upsertOwner({
          playerId: state.playerId,
          position: state.position,
          facing: state.facing,
          sprinting: state.sprinting,
          isSelf: state.playerId === this.status.playerId,
          // See `RestaurantScene#upsertOwner`'s own comment: another player's position is
          // remapped onto the decorative rival floor ONLY when they belong to a DIFFERENT
          // restaurant than this viewer — STORY-039's co-op partner shares this viewer's own
          // restaurant (`restaurantId`, not `playerId` — see `GameClientStatus.restaurantId`'s
          // own comment) and renders on THIS floor, at their real position, like the real
          // second owner they are. Every pre-existing mode has `restaurantId === playerId` for
          // both players, so this is byte-identical to the old `playerId` comparison there.
          remapToRivalFloor: state.restaurantId !== this.status.restaurantId,
        }),
      remove: (id) => this.scene.restaurant.removeOwner(id),
      ids: () => this.scene.restaurant.ownerIds(),
    });

    // STORY-016. Same seam as 'players' above: spawn/despawn entities reconciled by
    // `EntityViewRegistry`, called once per snapshot in `handleMessage` (not per frame —
    // customers/workers arrive at snapshot cadence, unlike interpolated player positions).
    this.registry.register<CustomerRenderState & { id: string }>('customers', {
      upsert: (state) => this.scene.restaurant.upsertCustomer(state),
      remove: (id) => this.scene.restaurant.removeCustomer(id),
      ids: () => this.scene.restaurant.customerIds(),
    });
    this.registry.register<WorkerRenderState & { id: string }>('workers', {
      upsert: (state) => this.scene.restaurant.upsertWorker(state),
      remove: (id) => this.scene.restaurant.removeWorker(id),
      ids: () => this.scene.restaurant.workerIds(),
    });
    // STORY-030 PRD §5.2. Same seam again: a ready ticket is a spawn/despawn entity (it appears
    // the moment `OrderSnapshot.state` flips to 'ready', disappears on pickup — STORY-031's
    // concern), unlike the fixed-count table badges/station indicators `updateFloorState`
    // updates directly. `id` here is `ticketId` (`orderId` is shared by every dish in one
    // party's order — see `OrderSnapshot`'s own doc comment on why `ticketId` is the one unique
    // per-dish key).
    this.registry.register<ReadyDishRenderState & { id: string }>('readyDishes', {
      upsert: (state) => this.scene.restaurant.upsertReadyDish(state),
      remove: (id) => this.scene.restaurant.removeReadyDish(id),
      ids: () => this.scene.restaurant.readyDishIds(),
    });
    // STORY-043. Same seam, second pool — see `RestaurantScene.ts#upsertQueueBoardDish`'s own
    // header on why this one is rank-indexed rather than held-slot like `readyDishes` above.
    this.registry.register<QueueBoardDishRenderState & { id: string }>('queueBoardDishes', {
      upsert: (state) => this.scene.restaurant.upsertQueueBoardDish(state),
      remove: (id) => this.scene.restaurant.removeQueueBoardDish(id),
      ids: () => this.scene.restaurant.queueBoardDishIds(),
    });

    this.network.onStatusChange = (connection) => this.patchStatus({ connection });
    this.network.onMessage = (message) => this.handleMessage(message);
    this.scene.onFrame = (dt) => this.handleFrame(dt);
    // See `SceneManager`'s own comment on why this can happen at all — surfaced into the HUD
    // (`GameClientStatus.graphicsContextLost`) so a player sees an explicit "reconnecting"
    // state instead of a silent black canvas with no explanation.
    this.scene.onContextLost = () => this.patchStatus({ graphicsContextLost: true });
    this.scene.onContextRestored = () => this.patchStatus({ graphicsContextLost: false });

    // PRD §8: `E` sends whatever `InteractionController` currently has resolved; `F` is the
    // secondary action, always "put down what I'm carrying" while carrying something and a
    // no-op otherwise — there is nothing else PRD §8 names for it that this MVP can act on
    // (see `INTERACT_ACTIONS`'s comment in messages.js for why `drop_carry` exists at all).
    this.input.onInteract = () => {
      if (this.status.nearPantry) {
        this.patchStatus({ showPantryBoard: !this.status.showPantryBoard });
        return;
      }
      if (this.status.nearKitchenCommandBoard) {
        this.patchStatus({ showKitchenCommandBoard: !this.status.showKitchenCommandBoard });
        return;
      }
      if (this.status.nearKitchenOrderQueueBoard) {
        this.patchStatus({ showKitchenOrderQueueBoard: !this.status.showKitchenOrderQueueBoard });
        return;
      }
      if (this.status.nearServiceStation) {
        this.patchStatus({ showServiceStationBoard: !this.status.showServiceStationBoard });
        return;
      }
      if (this.status.nearHostStand) {
        this.patchStatus({ showFrontDoorBoard: !this.status.showFrontDoorBoard });
        return;
      }
      if (this.status.prompt) {
        // STORY-031. See `lastInteractAction`'s own comment — recorded here, at the send site,
        // so the `error` handler can tell a `deliver` rejection apart from any other.
        this.lastInteractAction = this.status.prompt.action;
        this.network.sendInteract(this.status.prompt.targetId, this.status.prompt.action);
      }
    };
    this.input.onSecondary = () => {
      if (this.status.carrying.length > 0) {
        // STORY-031. Same `lastInteractAction` tracking as `onInteract` above — without this, a
        // `drop_carry` rejection right after an earlier `deliver` attempt would still read as
        // `lastInteractAction === 'deliver'` and fire a misleading "CAN'T DELIVER HERE" toast for
        // an action that was never a delivery attempt at all.
        this.lastInteractAction = 'drop_carry';
        this.network.sendInteract('self', 'drop_carry');
      }
    };
    // STORY-015 §8 "Tab: tactical overview panel". `InputController` already gates WHEN this
    // fires (`setTacticalOverviewEnabled`, updated below on every phase change); this is only
    // the toggle itself.
    this.input.onToggleOverview = () => {
      this.patchStatus({ showTacticalOverview: !this.status.showTacticalOverview });
    };
    // STORY-034. `Q`, held — the keyboard equivalent of the HUD's own Peek button
    // (`setPeeking`'s own comment). Both drive the exact same status field, so holding the
    // button and holding Q compose correctly (releasing one while still holding the other keeps
    // peeking true) without any extra state here.
    this.input.onPeek = (peeking) => this.setPeeking(peeking);
  }

  /**
   * @param roomId a fresh room to join (omit for the old token-less dev flow, which creates one)
   * @param inviteToken STORY-024. Required for a FRESH join against a private-invite room —
   *   see `NetworkClient.joinRoom`'s own comment on why it is safe to keep sending on a
   *   reconnect too.
   */
  start(roomId?: string, inviteToken?: string): void {
    this.inviteToken = inviteToken;
    this.network.connect();
    this.network.onStatusChange = (connection) => this.handleConnectionChange(connection, roomId);
    this.scene.start();
  }

  /**
   * STORY-022. The one place `NetworkClient`'s transport status turns into reconnect UX.
   * `'open'` always means "present the reconnect token if we have one" — `joinRoom` omits it
   * (undefined) on the very first connect, since `status.playerId` is still null then, and the
   * server treats a token-less `join_room` as a fresh seat either way (`Match#join`).
   *
   * `'closed'` only starts a retry loop once we have actually joined before (`status.playerId`
   * set) — an initial connection failure is not "reconnect UX", it is "the server never
   * answered", out of this story's scope. From there, every `'closed'` (the first drop, or a
   * failed retry attempt reopening) schedules exactly one more attempt after
   * `RECONNECT_RETRY_INTERVAL_MS`, until either the server's `joined` response (in
   * `handleMessage`) cancels the deadline or the deadline passes first — there is deliberately
   * no separate timer chain to keep in sync with this one. `'open'` itself does NOT clear
   * `reconnecting`/`reconnectDeadlineMs`: the transport opening is not the server confirming the
   * rejoin, and clearing early would drop the overlay during the gap where a
   * `match_ended`/`room_not_found` refusal for this same attempt could still arrive.
   */
  private handleConnectionChange(connection: 'connecting' | 'open' | 'closed', roomId?: string): void {
    this.patchStatus({ connection });

    if (connection === 'open') {
      // `roomId` here is only ever the URL param `start()` closed over — `undefined` in the
      // normal no-`?room=` dev flow. A RECONNECT must target the room the server already told
      // us about (`status.roomId`, set from the first `joined`), or a token-less `join_room`
      // with no `roomId` creates a brand-new empty room instead of rejoining the real one.
      // `reconnecting`/`reconnectDeadlineMs` are NOT cleared here — only once `joined` actually
      // arrives (below) — so the overlay stays up, and the retry budget stays live, for the gap
      // between the socket opening and the server answering the rejoin.
      this.network.joinRoom(this.status.roomId ?? roomId, this.status.playerId ?? undefined, this.inviteToken);
      return;
    }
    if (connection !== 'closed') return; // 'connecting' — nothing to react to yet
    if (this.disposed || this.status.disconnectedTerminal || !this.status.playerId) return;

    if (this.reconnectDeadlineMs === null) {
      this.reconnectDeadlineMs = Date.now() + RECONNECT_GRACE_MS + RECONNECT_GIVE_UP_BUFFER_MS;
      this.patchStatus({ reconnecting: true });
    }
    if (Date.now() > this.reconnectDeadlineMs) {
      this.patchStatus({ reconnecting: false, disconnectedTerminal: { reason: 'unreachable' } });
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.disposed || this.status.disconnectedTerminal) return;
      this.network.connect();
    }, RECONNECT_RETRY_INTERVAL_MS);
  }

  private handleMessage(message: ServerMessage): void {
    if (message.type === 'joined') {
      // STORY-022. Cleared HERE, not when the transport merely opens (`handleConnectionChange`)
      // — the server has now actually confirmed the rejoin, not just accepted a TCP connection.
      // Clearing earlier would drop the overlay (and the retry deadline) during the gap where a
      // `match_ended`/`room_not_found` refusal could still arrive for this same attempt.
      this.reconnectDeadlineMs = null;
      this.patchStatus({
        roomId: String(message.roomId),
        playerId: String(message.playerId),
        seed: String(message.seed),
        reconnecting: false,
      });
      return;
    }
    if (message.type === 'match_snapshot') {
      const players = (message.players ?? []) as PlayerState[];
      this.interpolator.push(players);
      const you = message.you as
        | {
            restaurantId?: string | null;
            ready?: boolean;
            setup?: AcceptedSetup | null;
            cash?: number | null;
            revenue?: number | null;
            purchasedUpgradeIds?: string[];
            pantry?: PantrySnapshot | null;
            kitchenCommand?: GameClientStatus['kitchenCommand'];
            managerLedger?: ManagerLedgerSnapshot | null;
            kitchenQueueBoard?: KitchenQueueBoardEntry[];
            resultsPreview?: MatchResult | null;
          }
        | null;
      // STORY-039. `you.restaurantId` off the wire — `playerId` for every pre-existing mode, the
      // shared co-op restaurant id for either co-op seat. Falls back to `playerId` only for the
      // theoretical case of an older server payload missing the field entirely (never true for
      // this codebase's own server, but cheap insurance against a stale cached build).
      const restaurantId = you?.restaurantId ?? this.status.playerId;
      const opponent = players.find((p) => p.playerId !== this.status.playerId);
      const self = players.find((p) => p.playerId === this.status.playerId) as
        | (PlayerState & { carrying?: string[]; currentAction?: string | null; carryCapacity?: number })
        | undefined;
      // STORY-015. Read once, reused below by `InteractionController`, the critical-alert
      // ranking, AND `GameClientStatus` itself, so there is exactly one cast site per array
      // rather than three independent ones drifting out of sync.
      const restaurants = (message.restaurants ?? []) as RestaurantSnapshot[];
      const customers = (message.customers ?? []) as CustomerSnapshot[];
      const orders = (message.orders ?? []) as OrderSnapshot[];
      const events = (message.events ?? []) as SnapshotEventEntry[];
      const eventForecast = (message.eventForecast ?? []) as SnapshotEventForecastEntry[];

      // STORY-031 PRD §5.3/§10.2. Supersedes STORY-012's generic plate-count indicator
      // (`setCarrying`) with real per-dish geometry: each player's OWN `carrying` (order ids,
      // already capped to that player's own `carryCapacity` — §8, never trust a longer array
      // than the snapshot itself confirms) is cross-referenced against `orders[]` for every
      // ticket/dish it decomposed into (an order is not always one plate — see
      // `CarriedDishRenderState`'s own comment), same snapshot cadence as everything else here,
      // not per render frame.
      for (const p of players as (PlayerState & { carrying?: string[]; carryCapacity?: number })[]) {
        const carryCapacity = p.carryCapacity ?? 1;
        const carriedOrderIds = (p.carrying ?? []).slice(0, carryCapacity);
        const slots = carriedOrderIds.flatMap((orderId) =>
          orders
            .filter((o) => o.orderId === orderId)
            .map((o) => ({ ticketId: o.ticketId, dishId: o.dishId })),
        );
        this.scene.restaurant.setCarriedDishes(p.playerId, slots);
      }
      // STORY-031 PRD §5.3. The destination-table target chip/arrow/ring — self's OWN carried
      // orders only (the rival's tables have no individually-rendered mesh a marker could attach
      // to; see `RestaurantScene#updateCarryTargets`'s own comment).
      const selfCarryTableIds = (self?.carrying ?? [])
        .map((orderId) => orders.find((o) => o.orderId === orderId)?.tableId ?? null)
        .filter((tableId): tableId is string => tableId !== null);
      this.scene.restaurant.updateCarryTargets(selfCarryTableIds);

      // STORY-029 PRD-027 §9. Diff this snapshot against the previous one, once, here — the same
      // "compute once per snapshot, patch the already-final result" discipline `criticalAlerts`
      // below already follows. `selfRestaurantId` is this snapshot's own resolved `restaurantId`
      // (STORY-039 — `playerId` in every pre-existing mode, see that const's own comment above).
      const presentationSnapshot: PresentationSnapshotInput = {
        selfRestaurantId: restaurantId,
        orders,
        events,
        // STORY-031. This viewer's OWN owner's carrying — see `detectOwnerPickedUpEvents`/
        // `detectOrderDeliveredEvents`'s own comments for why this is the un-sliced array (not
        // `selfCarryTableIds`/the capacity-sliced `slots` above): the reducer diffs the raw
        // `carrying[]` itself, same as the wire field.
        carrying: self?.carrying ?? [],
      };
      const newPresentationEvents = reducePresentationEvents(
        this.previousPresentationSnapshot,
        presentationSnapshot,
        this.emittedPresentationEventKeys,
      );
      for (const { key } of newPresentationEvents) this.emittedPresentationEventKeys.add(key);
      this.previousPresentationSnapshot = presentationSnapshot;

      // STORY-008. `InteractionController` is refreshed here (once per snapshot, ~10 Hz), not
      // in `handleFrame` (per render frame) — the candidates it reads (orders/customers/
      // restaurants) only change at snapshot cadence, and re-deriving them at frame rate would
      // be pure waste. `resolve()` itself still runs per frame, against interpolated position.
      this.interaction.setSnapshot({
        restaurantId,
        restaurants,
        orders,
        customers,
        carrying: self?.carrying ?? [],
        matchPhase: (message.matchPhase ?? null) as string | null,
        carryCapacity: self?.carryCapacity ?? 1,
      });
      const cash = you?.cash ?? null;
      const revenue = you?.revenue ?? null;
      const purchasedUpgradeIds = you?.purchasedUpgradeIds ?? [];
      const affordableUpgradeId = pickAffordableUpgrade(cash, purchasedUpgradeIds);
      // STORY-012 "Faster Grill I" / "Pantry Shelves": only the OWNER'S OWN restaurant has
      // these station/pantry meshes at all (the competitor is a simplified shell — see
      // `RestaurantScene#buildCompetitor`), and ownership rarely changes, so this only touches
      // the scene when the owned set actually changed rather than every ~10 Hz snapshot.
      if (purchasedUpgradeIds.join(',') !== this.status.purchasedUpgradeIds.join(',')) {
        this.scene.restaurant.setStationUpgraded('grill', purchasedUpgradeIds.includes('faster_grill_1'));
        this.scene.restaurant.setPantryUpgraded(purchasedUpgradeIds.includes('pantry_shelves_1'));
        this.scene.restaurant.setFrontDoorUpgrades(purchasedUpgradeIds);
      }

      // STORY-016 PRD §4.4/§14 "visual state language". Customers and this restaurant's own
      // workers are spawn/despawn entities reconciled through `EntityViewRegistry`, the same
      // seam `players` above already uses — see `RestaurantScene.ts`'s own comment on why
      // `customers` is filtered HERE (STORY-039: this snapshot's own resolved restaurant, not
      // `playerId` — see that const's own comment above), before the registry ever sees it:
      // table ids are shared literal strings across both restaurants' own internal layouts, so
      // an unfiltered reconcile would try to render the rival's queued/seated party onto this
      // restaurant's floor. Everything else this story adds (table badges, station
      // queue/shortage, rival activity, the event effect) is NOT a spawn/despawn entity — those
      // update through the single `updateFloorState` call below, which does its own
      // restaurant-scoped filtering (see that method's own header).
      //
      // STORY-044. Widened from a bare `c.restaurantId === restaurantId` equality (an OR added,
      // not removed — the table-collision reason above still holds for a party actually queued
      // or seated at the rival) to also include every party currently in genuinely shared
      // district space — still deciding, or already gone — regardless of whose restaurant it
      // belongs to: `shouldRenderCustomerForViewer` (`shared/game-logic/district-population.js`)
      // is the ONE place that OR is expressed, dual-imported by this story's own check script so
      // the two can never quietly diverge. This is what makes "it seems like they just show up"
      // false: a party's whole pre-decision walk, and its walk back out, are now visible here.
      const renderableCustomers = customers.filter((c) => shouldRenderCustomerForViewer(c, restaurantId));
      const orderLabelForCustomer = (customer: CustomerSnapshot): string | null => {
        if (!customer.orderId) return null;
        const dishes = orders
          .filter((order) => order.orderId === customer.orderId)
          .map((order) => order.dishId.replace(/_/g, ' ').toUpperCase());
        const distinct = [...new Set(dishes)];
        return distinct.length > 0 ? distinct.slice(0, 2).join(' + ') : null;
      };
      this.registry.reconcile('customers', renderableCustomers.map((c) => ({
        ...c,
        id: c.customerId,
        orderLabel: orderLabelForCustomer(c),
      })));
      const selfRestaurantForWorkers = restaurants.find((r) => r.restaurantId === restaurantId);
      this.registry.reconcile(
        'workers',
        (selfRestaurantForWorkers?.workers ?? []).map((w) => ({ ...w, id: w.workerId })),
      );

      // STORY-030 PRD §5.2. Also a spawn/despawn entity, same reasoning — a raw, unfiltered
      // reconcile would render the rival kitchen's ready tickets at this restaurant's pass.
      // `isOldest` is derived HERE (not in `RestaurantScene.ts` — Pattern 4/11: the scene renders
      // state, it does not rank it) by comparing `readyAgeMs` across every ticket this
      // restaurant currently has ready; ties keep whichever `Array#reduce` visits first, which is
      // fine — PRD §5.2 only asks that THE oldest be highlighted, not that a tie be broken any
      // particular way.
      //
      // STORY-031. Also excludes any order in the SELF owner's OWN `carrying[]` — a ticket stays
      // `state: 'ready'` the whole time it is being carried (only `order.claimedBy` changes
      // server-side; see `action-validator.js#resolvePickup`), so without this exclusion a
      // picked-up ticket would keep rendering at the pass AND in the carry socket at once. This
      // is what makes the AC's "pass-side proxy removed the instant it enters carrying[]" true.
      const selfCarryingOrderIds = new Set(self?.carrying ?? []);
      const selfReadyOrders = orders.filter(
        (o) =>
          o.restaurantId === restaurantId &&
          o.state === 'ready' &&
          !selfCarryingOrderIds.has(o.orderId),
      );
      const oldestTicketId =
        selfReadyOrders.length > 0
          ? selfReadyOrders.reduce((oldest, o) => (o.readyAgeMs > oldest.readyAgeMs ? o : oldest)).ticketId
          : null;
      this.registry.reconcile(
        'readyDishes',
        selfReadyOrders.map((o) => ({
          id: o.ticketId,
          ticketId: o.ticketId,
          dishId: o.dishId,
          tableId: o.tableId,
          readyAgeMs: o.readyAgeMs,
          isOldest: o.ticketId === oldestTicketId,
        })),
      );

      // STORY-043. `you.kitchenQueueBoard` arrives ALREADY ranked (server-side
      // `worker-system.js#compareTickets`, via `queuedTicketsAcrossStations`) — `rank` here is
      // just this array's own index, not a re-ranking (Pattern 4/11: the client labels
      // already-ordered state, it does not compute order). No restaurant-id filtering needed,
      // unlike `selfReadyOrders`/`orders` above: `you.kitchenQueueBoard` is already viewer-scoped
      // to this restaurant server-side (`match.js#toSnapshot`'s own comment).
      const kitchenQueueBoard = you?.kitchenQueueBoard ?? [];
      this.registry.reconcile(
        'queueBoardDishes',
        kitchenQueueBoard.map((entry, rank) => ({
          id: entry.ticketId,
          ticketId: entry.ticketId,
          dishId: entry.dishId,
          rank,
        })),
      );

      this.scene.restaurant.updateFloorState({
        selfRestaurantId: restaurantId,
        restaurants,
        customers,
        orders,
        events,
      });
      // STORY-014. Swap the render loop's backdrop on the `results` phase transition — see
      // SceneManager#setActiveScene's own comment on why this is a per-snapshot, not per-frame,
      // check.
      const nextPhase = (message.matchPhase ?? null) as MatchPhase | null;
      const phaseChanged = nextPhase !== this.status.matchPhase;
      if (phaseChanged) {
        this.scene.setActiveScene(nextPhase === 'results' ? 'results' : 'other');
      }
      // STORY-015 §8: Tab only does anything during `service`/`final_rush` — see
      // `InputController#tacticalOverviewEnabled`'s own comment. Leaving those phases also
      // force-closes the panel so it cannot survive into `results` showing stale data.
      const tacticalOverviewPhase = nextPhase === 'service' || nextPhase === 'final_rush';
      if (phaseChanged) this.input.setTacticalOverviewEnabled(tacticalOverviewPhase);

      // STORY-015 §14 "Floating cash/tip feedback only for major moments, not every
      // transaction". The decision itself (including the first-sample guard) is
      // `cashFeedbackFor` (`shared/game-logic/hud-cash-feedback.js`) — pure, and the same
      // function `scripts/check-hud.mjs` exercises directly — so this is only the timer/patch
      // side effect around whatever it returns.
      let cashFeedbackPatch: Partial<GameClientStatus> = {};
      const feedback = cashFeedbackFor(this.status.revenue, revenue, HUD_CASH_FEEDBACK_MIN_DELTA);
      if (feedback !== null) {
        if (this.cashFeedbackTimeout !== null) clearTimeout(this.cashFeedbackTimeout);
        this.cashFeedbackTimeout = setTimeout(() => {
          this.cashFeedbackTimeout = null;
          this.patchStatus({ cashFeedback: null });
        }, HUD_CASH_FEEDBACK_DISPLAY_MS);
        cashFeedbackPatch = { cashFeedback: { amount: feedback.amount, atMs: Date.now() } };
      }

      const serviceStation = (message.serviceStation ?? {}) as GameClientStatus['serviceStation'];
      // STORY-039. `serviceStation`/`frontDoor` are now keyed by restaurantId (see
      // `match.js#toSnapshot`) — `previousContracts` reads the PRIOR snapshot's resolved
      // restaurant (`this.status.restaurantId`, already patched from it), `nextContracts` reads
      // THIS one's (the local `restaurantId` const above). Both equal `playerId` in every
      // pre-existing mode.
      const previousContracts = this.status.serviceStation[this.status.restaurantId ?? '']?.contracts ?? [];
      const nextContracts = serviceStation[restaurantId ?? '']?.contracts ?? [];
      const arrived = nextContracts.find((contract) => contract.status === 'active' && previousContracts.find((old) => old.workerId === contract.workerId)?.status === 'arriving');
      const hired = nextContracts.find((contract) => !previousContracts.some((old) => old.workerId === contract.workerId));
      const serviceStationNotice = arrived
        ? `${arrived.contractId.replace(/_/g, ' ').toUpperCase()} ARRIVED`
        : hired ? `${hired.contractId.replace(/_/g, ' ').toUpperCase()} CALLED` : null;
      if (serviceStationNotice) {
        if (this.serviceStationNoticeTimeout !== null) clearTimeout(this.serviceStationNoticeTimeout);
        this.serviceStationNoticeTimeout = setTimeout(() => {
          this.serviceStationNoticeTimeout = null;
          this.patchStatus({ serviceStationNotice: null });
        }, 2200);
      }

      this.patchStatus({
        playerCount: players.length,
        // STORY-039. See that field's own comment.
        restaurantId,
        // STORY-040. See that field's own comment.
        sharedRestaurant: Boolean(message.sharedRestaurant),
        // STORY-024. `players[]` on the wire also carries `ready` (see match.js#toSnapshot),
        // which `PlayerState` above does not declare — same narrow cast `opponentReady` already
        // uses just below for the identical reason.
        players: players.map((p) => ({
          playerId: p.playerId,
          connected: p.connected ?? true,
          ready: Boolean((p as unknown as { ready?: boolean }).ready),
        })),
        serverTime: Number(message.serverTime ?? 0),
        // Rendered as received. No local clock — see GameClientStatus.
        matchPhase: nextPhase,
        timeRemainingMs:
          typeof message.timeRemainingMs === 'number' ? message.timeRemainingMs : null,
        market: (message.market ?? null) as PublicMarket | null,
        ready: Boolean(you?.ready),
        setup: you?.setup ?? null,
        opponentReady: Boolean((opponent as { ready?: boolean } | undefined)?.ready),
        // An accepted submission clears the last rejection: the snapshot IS the acceptance
        // receipt, so there is no second message to wait for.
        ...(you?.setup ? { setupRejection: null } : {}),
        carrying: self?.carrying ?? [],
        currentAction: self?.currentAction ?? null,
        cash,
        revenue,
        purchasedUpgradeIds,
        pantry: you?.pantry ?? null,
        canAffordUpgrade: affordableUpgradeId !== null,
        affordableUpgradeId,
        restaurants,
        customers,
        orders,
        events,
        eventForecast,
        frontDoor: (message.frontDoor ?? {}) as GameClientStatus['frontDoor'],
        serviceStation,
        kitchenCommand: (you?.kitchenCommand ?? null) as GameClientStatus['kitchenCommand'],
        managerLedger: you?.managerLedger ?? null,
        // STORY-043. Same array `kitchenQueueBoard` above (the const feeding the scene reconcile)
        // reads — reused, not recomputed, so the panel and the scene pool can never disagree on
        // which tickets exist or their order.
        kitchenQueueBoard,
        // STORY-052. Straight off `you.resultsPreview` — see that wire field's own `.d.ts`
        // comment for why it is safe to publish this early (the viewer's own slice only) and
        // `GameClientStatus.resultsPreview`'s own comment for who reads it.
        resultsPreview: you?.resultsPreview ?? null,
        ...(serviceStationNotice ? { serviceStationNotice } : {}),
        // STORY-015. Ranked (§18 order) and already capped (`HUD_CRITICAL_ALERTS_MAX`) here,
        // once per snapshot — see `criticalAlerts`'s own field comment on why.
        criticalAlerts: capCriticalAlerts(
          buildCriticalAlerts({
            selfRestaurantId: restaurantId,
            restaurants,
            customers,
            orders,
            events,
            canAffordUpgrade: affordableUpgradeId !== null,
            affordableUpgradeId,
          }),
          HUD_CRITICAL_ALERTS_MAX,
        ),
        ...(phaseChanged && !tacticalOverviewPhase ? { showTacticalOverview: false } : {}),
        ...cashFeedbackPatch,
        // STORY-029. Reuse the shared empty-array reference on the (overwhelmingly common) empty
        // case — see that constant's own comment on why.
        presentationEvents: newPresentationEvents.length > 0 ? newPresentationEvents : EMPTY_PRESENTATION_EVENTS,
        // STORY-025. Verbatim off the wire — see `GameClientStatus.bots`'s own field comment.
        bots: (message.bots ?? []) as BotSnapshotEntry[],
      });
      this.scene.restaurant.setHostStandSpecial((message.frontDoor as GameClientStatus['frontDoor'] | undefined)?.[restaurantId ?? '']?.activeSpecialId ?? null);
      this.scene.restaurant.setPantryCommandState(you?.pantry?.overallRisk ?? 'STOCKED', you?.pantry?.deliveries.length ?? 0);
      this.scene.restaurant.setPantryIngredients(you?.pantry?.ingredients ?? []);
      const focusId = (you?.kitchenCommand as GameClientStatus['kitchenCommand'] | undefined)?.activeFocusId ?? kitchenCommandData.defaultFocusId;
      const focus = kitchenCommandData.focuses.find((item) => item.id === focusId);
      this.scene.restaurant.setKitchenFocus(focus?.name ?? focusId.replace(/_/g, ' '));
      return;
    }
    if (message.type === 'match_complete') {
      // STORY-014. Stored verbatim — see `matchComplete`'s own field comment. `ResultsPanel`
      // reads `matchComplete.results[playerId]` for a full `MatchResult`, never re-derives one.
      this.patchStatus({
        endReason: (message.reason ?? 'completed') as MatchEndReason,
        matchComplete: message as unknown as MatchCompleteMessage,
      });
      return;
    }
    if (message.type === 'error') {
      if (message.error === 'setup_rejected') {
        this.patchStatus({
          setupRejection: {
            reason: String(message.reason ?? 'unknown'),
            detail: String(message.detail ?? ''),
          },
        });
      }
      // STORY-031 PRD §5.3/§8/§9. A rejected `deliver` attempt (`action-validator.js#resolveDeliver`
      // — `wrong_table`/`not_ready`/`out_of_range`/`no_such_target`) did NOT change authoritative
      // state, so it is deliberately NOT run through `reducePresentationEvents`'s dedup-key
      // machinery (that machinery exists for real snapshot transitions only — see the reducer's
      // own file-header comment on this exact type). Instead: a direct, ungated toast, with a
      // freshly-minted key every time so it is never suppressed as a "repeat" of anything.
      if (message.error === 'interact_rejected' && this.lastInteractAction === 'deliver') {
        const rejection: EmittedPresentationEvent = {
          key: `delivery-rejected:${this.status.playerId}:${Date.now()}`,
          event: { type: 'delivery-rejected', reason: String(message.reason ?? 'unknown') },
        };
        this.patchStatus({ presentationEvents: [rejection] });
      }
      // STORY-022. The server's answer to a rejoin attempt arriving too late — see
      // `match.js#join`'s own comment on why this is `match_ended`, not `match_full`. Also
      // covers `room_not_found` (e.g. a dev server restart): either way, this is the
      // authoritative "stop retrying" the transport-level `unreachable` timeout in
      // `handleConnectionChange` exists only to approximate when the server cannot be reached
      // to say so.
      if (message.error === 'match_ended' || message.error === 'room_not_found') {
        if (this.reconnectTimer !== null) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
        this.reconnectDeadlineMs = null;
        this.patchStatus({
          reconnecting: false,
          disconnectedTerminal: {
            reason: message.error === 'match_ended' ? String(message.reason ?? 'completed') : 'room_not_found',
          },
        });
      }
      console.warn('[net] server error', message);
    }
  }

  /** PRD §12 room-flow step 7 / §5 "ready up". Accepted by the server in lobby and setup. */
  setReady(ready = true): void {
    this.network.sendReady(ready);
  }

  /**
   * STORY-034. Client-only camera state, never sent to the server — "peeking" doesn't move the
   * owner or affect anything authoritative, it only re-aims `handleFrame`'s camera target at the
   * shared district instead of the owner's own floor. A HOLD (the HUD button's
   * pointerdown/pointerup), not a toggle: while peeking, the owner's own floor is off-screen, so
   * leaving it engaged would be a trap a player has to remember to cancel rather than a quick
   * glance.
   *
   * STORY-045. Also swaps `CameraController`'s whole settings profile, not just the target.
   * The RETARGET below (`handleFrame`'s `PEEK_CAMERA_TARGET_Z`) is what does most of the work
   * of bringing the district street into a legibly-framed band of the shot; `PEEK_CAMERA` adds
   * a modest additional pull-back on top of that (see its own comment, `CameraController.ts`,
   * for why its `fov` is deliberately left unchanged rather than also widened).
   * `PEEK_CAMERA`/`DEFAULT_CAMERA` (both full `CameraSettings` objects) are swapped wholesale
   * here, on the true/false edges of the hold, rather than patched per-frame in `handleFrame`
   * below — cheaper (this only runs on state change, not every render frame) and it means
   * `applySettings` is never asked to blend a stale leftover field from the other profile.
   */
  setPeeking(peeking: boolean): void {
    this.patchStatus({ peeking });
    this.scene.cameraController.setSettings(peeking ? PEEK_CAMERA : DEFAULT_CAMERA);
    this.scene.restaurant.setDistrictVisible(peeking);
    this.scene.restaurant.setCompetitorVisible(peeking);
  }

  /**
   * PRD §7 / §12 `setup_submit`. Sent as intent like everything else: the client's own checks
   * are UX, and `setup-validator.js` decides. Acceptance shows up as `you.setup` in the next
   * snapshot; refusal as a `setup_rejected` error carrying the reason.
   */
  submitSetup(payload: SetupSubmitPayload): void {
    this.patchStatus({ setupRejection: null });
    this.network.sendSetupSubmit(payload as unknown as Record<string, unknown>);
  }

  /** PRD §12 client-to-server example 3, §10 "Upgrades". `UpgradeTerminal`'s Buy button calls
   * this; `action-validator.js#handlePurchaseUpgrade` is the actual authority. */
  buyUpgrade(upgradeId: string): void {
    this.network.sendPurchaseUpgrade(upgradeId);
  }

  activateSpecial(specialId: string): void { this.network.sendInteract(`special_${specialId}`, 'activate_special'); }

  seatWaitingParty(): void { this.network.sendInteract('host_stand', 'seat'); }

  serviceStationCommand(command: string): void { this.network.sendInteract(`service_${command}`, 'service_command'); }

  placePantryOrder(productId: string, ingredientId: string): void {
    this.network.sendInteract(`pantry:${productId}:${ingredientId}`, 'pantry_order');
  }

  restockKitchen(): void { this.network.sendInteract('pantry', 'restock'); }

  kitchenFocusCommand(focusId: string): void { this.network.sendInteract(`kitchen_focus_${focusId}`, 'kitchen_command'); }

  /**
   * STORY-042. `StationMenu`'s row buttons all call this — it is BYTE-IDENTICAL to what the
   * single-tap `E — Cook X`/`E — Plate X` prompt already sends for this station
   * (`InteractionController#stationCandidate`, `action-validator.js#resolveCookOrPlate`): same
   * targetId, same action, no dish/ticket id anywhere in the wire payload. The server still
   * auto-picks the oldest-queued ticket at this station regardless of which menu row was
   * clicked — see `StationMenu.tsx`'s own header for why the menu's ranking and the server's
   * selection are expected to usually agree without the client ever choosing a ticket.
   */
  cookOrPlateAt(station: string): void {
    this.network.sendInteract(`station_${station}`, station === 'plating' ? 'plate' : 'cook');
  }

  private handleFrame(dt: number): void {
    // Render from interpolated state, never from locally integrated positions.
    const players = this.interpolator.sample();
    this.registry.reconcile('players', players);

    // STORY-016 PRD §4.4 "visibly look impatient" — a per-frame posture animation, not a
    // per-snapshot one, so it stays smooth between the ~10Hz snapshots that actually move
    // `patienceRemaining`.
    this.elapsedSeconds += dt;
    this.scene.restaurant.updateCustomerAnimations(this.elapsedSeconds);
    // STORY-030 PRD §5.2 "highlight or pulse the oldest ready ticket first" — per-frame, same
    // split as the customer posture animation above.
    this.scene.restaurant.updateReadyDishAnimations(this.elapsedSeconds);
    // The counter bell replacing the ticket-ready screen toast — same per-frame split.
    this.scene.restaurant.updateReadyBellAnimation(this.elapsedSeconds);
    // STORY-031 PRD §5.3 — the destination-table marker's pulse/bob, same per-frame split.
    this.scene.restaurant.updateCarryTargetAnimations(this.elapsedSeconds);
    // Smooths worker positions between ~10Hz snapshots — see updateWorkerAnimations's own
    // comment on why workers need this and owners don't.
    this.scene.restaurant.updateWorkerAnimations();

    const self = players.find((p) => p.playerId === this.status.playerId);
    if (this.status.peeking) {
      // `PEEK_CAMERA_TARGET_Z` (`shared/constants/tuning.js`, with the frustum reasoning in its
      // own comment) biases the shot toward the authored rival room at z=-24.5 while retaining
      // the district street and its moving parties behind it. `PEEK_CAMERA` already swapped
      // `CameraController` onto the pulled-back profile (own comment there) — this call only
      // ever needs to move the target, not the framing.
      this.scene.cameraController.setTarget(0, PEEK_CAMERA_TARGET_Z);
    } else if (self) {
      this.scene.cameraController.setTarget(
        Math.max(-1.3, Math.min(1.3, self.position.x * 0.18)),
        Math.max(-1.5, Math.min(1.5, self.position.z * 0.18)),
      );
    }

    // STORY-008. Re-resolved every frame against interpolated position (cheap: a handful of
    // array scans, no allocation on the hot path beyond the winning candidate), but only
    // patched into `status` when it actually changes, so the HUD re-renders on prompt CHANGE,
    // not at frame rate.
    if (self) {
      const prompt = this.interaction.resolve(self.position);
      const changed =
        prompt?.targetId !== this.status.prompt?.targetId || prompt?.action !== this.status.prompt?.action;
      if (changed) this.patchStatus({ prompt });

      // STORY-012. Same per-frame/patch-on-change discipline as `prompt` — the terminal shop
      // overlay opens on proximity, not an `E` press (see `InteractionController#nearUpgradeTerminal`).
      const nearTerminal = this.interaction.nearUpgradeTerminal(self.position);
      if (nearTerminal !== this.status.nearUpgradeTerminal) {
        this.patchStatus({ nearUpgradeTerminal: nearTerminal });
      }
      const nearHostStand = this.interaction.inRangeOf(self.position, 'host_stand');
      if (nearHostStand !== this.status.nearHostStand) {
        this.patchStatus({ nearHostStand, showFrontDoorBoard: nearHostStand ? this.status.showFrontDoorBoard : false });
      }
      const nearServiceStation = this.interaction.inRangeOf(self.position, 'service_station');
      if (nearServiceStation !== this.status.nearServiceStation) {
        this.patchStatus({ nearServiceStation, showServiceStationBoard: nearServiceStation ? this.status.showServiceStationBoard : false });
      }
      const nearPantry = this.interaction.inRangeOf(self.position, 'pantry');
      if (nearPantry !== this.status.nearPantry) {
        this.patchStatus({ nearPantry, showPantryBoard: nearPantry ? this.status.showPantryBoard : false });
      }
      const nearKitchenCommandBoard = this.interaction.inRangeOf(self.position, 'kitchen_command_board');
      if (nearKitchenCommandBoard !== this.status.nearKitchenCommandBoard) {
        this.patchStatus({
          nearKitchenCommandBoard,
          showKitchenCommandBoard: nearKitchenCommandBoard ? this.status.showKitchenCommandBoard : false,
        });
      }
      // STORY-042. Same per-frame/patch-on-change discipline as every `nearX` read above.
      const nearStation = this.interaction.nearStation(self.position);
      if (nearStation !== this.status.nearStation) {
        this.patchStatus({ nearStation });
      }
      // STORY-043. Same pattern as `nearKitchenCommandBoard` just above, for the second board.
      const nearKitchenOrderQueueBoard = this.interaction.inRangeOf(self.position, 'kitchen_order_queue_board');
      if (nearKitchenOrderQueueBoard !== this.status.nearKitchenOrderQueueBoard) {
        this.patchStatus({
          nearKitchenOrderQueueBoard,
          showKitchenOrderQueueBoard: nearKitchenOrderQueueBoard ? this.status.showKitchenOrderQueueBoard : false,
        });
      }
    }

    this.sinceInputSend += dt * 1000;
    if (this.sinceInputSend >= 1000 / INPUT_SEND_HZ) {
      this.sinceInputSend = 0;
      this.network.sendInput(
        this.input.getMoveIntent(this.scene.cameraController.getSettings().angle),
        this.input.getFacing(),
      );
    }
  }

  private patchStatus(patch: Partial<GameClientStatus>): void {
    this.status = { ...this.status, ...patch };
    this.onStatus?.(this.status);
  }

  dispose(): void {
    // Set before `network.disconnect()`, which itself triggers a 'closed' event —
    // `handleConnectionChange` checks this flag first so a deliberate teardown never starts a
    // retry loop.
    this.disposed = true;
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    if (this.cashFeedbackTimeout !== null) clearTimeout(this.cashFeedbackTimeout);
    if (this.serviceStationNoticeTimeout !== null) clearTimeout(this.serviceStationNoticeTimeout);
    this.input.dispose();
    this.network.disconnect();
    this.interpolator.clear();
    this.scene.dispose();
  }
}
