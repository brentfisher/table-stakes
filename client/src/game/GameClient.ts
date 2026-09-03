// Wires transport, input, interpolation, and scene together. This is the single object the
// React shell creates and disposes; React never reaches past it into the scene graph.

import { NetworkClient, type ServerMessage } from './NetworkClient';
import { InputController } from './InputController';
import { StateInterpolator, type PlayerState } from './StateInterpolator';
import { EntityViewRegistry } from './EntityViewRegistry';
import { SceneManager } from './SceneManager';
import { InteractionController, type InteractionPrompt } from './InteractionController';
import type {
  CustomerSnapshot,
  MatchCompleteMessage,
  MatchEndReason,
  MatchPhase,
  OrderSnapshot,
  PublicMarket,
  RestaurantSnapshot,
} from '../../../shared/schemas/messages';
import type { AcceptedSetup } from '../../../shared/schemas/setup-rules';
import upgradesData from '../../../shared/game-data/upgrades.json';

interface UpgradeInfo {
  id: string;
  cost: number;
  requires?: string;
}
const UPGRADE_BY_ID = new Map<string, UpgradeInfo>(
  (upgradesData.upgrades as UpgradeInfo[]).map((u) => [u.id, u]),
);
/** STORY-012. Only these 5 of the 11 catalogue entries have a live effect hook — see
 * `server/src/game/systems/upgrade-system.js`'s `KNOWN_EFFECT_KEYS`. The affordability
 * indicator and the terminal overlay both restrict to this list; the other 6 are legal
 * catalogue data with nothing yet reading them. */
export const WIRED_UPGRADE_IDS = [
  'serving_tray_1',
  'serving_tray_2',
  'faster_grill_1',
  'better_seating_1',
  'pantry_shelves_1',
];

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
export interface GameClientStatus {
  connection: 'connecting' | 'open' | 'closed';
  roomId: string | null;
  playerId: string | null;
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
  /**
   * STORY-012 AC: "shows an upgrade-availability indicator ... without forcing a trip to
   * check." True when at least one of `WIRED_UPGRADE_IDS` is unowned, has its `requires` (if
   * any) already owned, and costs no more than `cash` — computed from public catalogue data,
   * not duplicated server-side.
   */
  canAffordUpgrade: boolean;
}

/** STORY-012 AC: an ambient "something is worth buying" signal, computed from public catalogue
 * data — never a second copy of `action-validator.js#handlePurchaseUpgrade`'s own legality
 * checks, just the subset a HUD indicator needs (unaffordable/owned/locked all read the same). */
function canAffordAnyUpgrade(cash: number | null, owned: string[]): boolean {
  if (cash === null) return false;
  return WIRED_UPGRADE_IDS.some((id) => {
    if (owned.includes(id)) return false;
    const upgrade = UPGRADE_BY_ID.get(id);
    if (!upgrade) return false;
    if (upgrade.requires && !owned.includes(upgrade.requires)) return false;
    return upgrade.cost <= cash;
  });
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
  private status: GameClientStatus = {
    connection: 'closed',
    roomId: null,
    playerId: null,
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
    prompt: null,
    carrying: [],
    currentAction: null,
    cash: null,
    purchasedUpgradeIds: [],
    nearUpgradeTerminal: false,
    canAffordUpgrade: false,
  };

  /** Called at panel cadence, not per frame — React subscribes here. */
  onStatus: ((status: GameClientStatus) => void) | null = null;

  constructor(container: HTMLElement) {
    this.scene = new SceneManager(container);
    this.input = new InputController(window);

    this.registry.register<PlayerState>('players', {
      upsert: (state) =>
        this.scene.restaurant.upsertOwner({
          playerId: state.playerId,
          position: state.position,
          facing: state.facing,
          sprinting: state.sprinting,
          isSelf: state.playerId === this.status.playerId,
        }),
      remove: (id) => this.scene.restaurant.removeOwner(id),
      ids: () => this.scene.restaurant.ownerIds(),
    });

    this.network.onStatusChange = (connection) => this.patchStatus({ connection });
    this.network.onMessage = (message) => this.handleMessage(message);
    this.scene.onFrame = (dt) => this.handleFrame(dt);

    // PRD §8: `E` sends whatever `InteractionController` currently has resolved; `F` is the
    // secondary action, always "put down what I'm carrying" while carrying something and a
    // no-op otherwise — there is nothing else PRD §8 names for it that this MVP can act on
    // (see `INTERACT_ACTIONS`'s comment in messages.js for why `drop_carry` exists at all).
    this.input.onInteract = () => {
      if (this.status.prompt) this.network.sendInteract(this.status.prompt.targetId, this.status.prompt.action);
    };
    this.input.onSecondary = () => {
      if (this.status.carrying.length > 0) this.network.sendInteract('self', 'drop_carry');
    };
  }

  start(roomId?: string): void {
    this.network.connect();
    this.network.onStatusChange = (connection) => {
      this.patchStatus({ connection });
      if (connection === 'open') this.network.joinRoom(roomId);
    };
    this.scene.start();
  }

  private handleMessage(message: ServerMessage): void {
    if (message.type === 'joined') {
      this.patchStatus({
        roomId: String(message.roomId),
        playerId: String(message.playerId),
        seed: String(message.seed),
      });
      return;
    }
    if (message.type === 'match_snapshot') {
      const players = (message.players ?? []) as PlayerState[];
      this.interpolator.push(players);
      // STORY-012 "Serving Tray": one small plate mesh per carried order, public — see
      // `RestaurantScene#setCarrying`. Snapshot cadence (~10 Hz) is plenty for a count that
      // only changes on pickup/deliver/drop, so this does not go through `handleFrame`.
      for (const p of players as (PlayerState & { carrying?: string[] })[]) {
        this.scene.restaurant.setCarrying(p.playerId, p.carrying?.length ?? 0);
      }
      const you = message.you as
        | {
            ready?: boolean;
            setup?: AcceptedSetup | null;
            cash?: number | null;
            purchasedUpgradeIds?: string[];
          }
        | null;
      const opponent = players.find((p) => p.playerId !== this.status.playerId);
      const self = players.find((p) => p.playerId === this.status.playerId) as
        | (PlayerState & { carrying?: string[]; currentAction?: string | null; carryCapacity?: number })
        | undefined;
      // STORY-008. `InteractionController` is refreshed here (once per snapshot, ~10 Hz), not
      // in `handleFrame` (per render frame) — the candidates it reads (orders/customers/
      // restaurants) only change at snapshot cadence, and re-deriving them at frame rate would
      // be pure waste. `resolve()` itself still runs per frame, against interpolated position.
      this.interaction.setSnapshot({
        restaurantId: this.status.playerId,
        restaurants: (message.restaurants ?? []) as RestaurantSnapshot[],
        orders: (message.orders ?? []) as OrderSnapshot[],
        customers: (message.customers ?? []) as CustomerSnapshot[],
        carrying: self?.carrying ?? [],
        matchPhase: (message.matchPhase ?? null) as string | null,
        carryCapacity: self?.carryCapacity ?? 1,
      });
      const cash = you?.cash ?? null;
      const purchasedUpgradeIds = you?.purchasedUpgradeIds ?? [];
      // STORY-012 "Faster Grill I" / "Pantry Shelves": only the OWNER'S OWN restaurant has
      // these station/pantry meshes at all (the competitor is a simplified shell — see
      // `RestaurantScene#buildCompetitor`), and ownership rarely changes, so this only touches
      // the scene when the owned set actually changed rather than every ~10 Hz snapshot.
      if (purchasedUpgradeIds.join(',') !== this.status.purchasedUpgradeIds.join(',')) {
        this.scene.restaurant.setStationUpgraded('grill', purchasedUpgradeIds.includes('faster_grill_1'));
        this.scene.restaurant.setPantryUpgraded(purchasedUpgradeIds.includes('pantry_shelves_1'));
      }
      // STORY-014. Swap the render loop's backdrop on the `results` phase transition — see
      // SceneManager#setActiveScene's own comment on why this is a per-snapshot, not per-frame,
      // check.
      const nextPhase = (message.matchPhase ?? null) as MatchPhase | null;
      if (nextPhase !== this.status.matchPhase) {
        this.scene.setActiveScene(nextPhase === 'results' ? 'results' : 'other');
      }
      this.patchStatus({
        playerCount: players.length,
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
        purchasedUpgradeIds,
        canAffordUpgrade: canAffordAnyUpgrade(cash, purchasedUpgradeIds),
      });
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
      console.warn('[net] server error', message);
    }
  }

  /** PRD §12 room-flow step 7 / §5 "ready up". Accepted by the server in lobby and setup. */
  setReady(ready = true): void {
    this.network.sendReady(ready);
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

  private handleFrame(dt: number): void {
    // Render from interpolated state, never from locally integrated positions.
    const players = this.interpolator.sample();
    this.registry.reconcile('players', players);

    const self = players.find((p) => p.playerId === this.status.playerId);
    if (self) this.scene.cameraController.setTarget(self.position.x, self.position.z);

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
    }

    this.sinceInputSend += dt * 1000;
    if (this.sinceInputSend >= 1000 / INPUT_SEND_HZ) {
      this.sinceInputSend = 0;
      this.network.sendInput(this.input.getMoveIntent(), this.input.getFacing());
    }
  }

  private patchStatus(patch: Partial<GameClientStatus>): void {
    this.status = { ...this.status, ...patch };
    this.onStatus?.(this.status);
  }

  dispose(): void {
    this.input.dispose();
    this.network.disconnect();
    this.interpolator.clear();
    this.scene.dispose();
  }
}
