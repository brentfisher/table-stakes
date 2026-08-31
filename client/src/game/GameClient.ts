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
  MatchEndReason,
  MatchPhase,
  OrderSnapshot,
  PublicMarket,
  RestaurantSnapshot,
} from '../../../shared/schemas/messages';
import type { AcceptedSetup } from '../../../shared/schemas/setup-rules';

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
   * STORY-008 §8 "contextual interact prompt" — `InteractionController`'s current pick, or
   * null with nothing in range. Recomputed every render frame from interpolated position but
   * only patched into status on CHANGE, so the HUD does not re-render at frame rate.
   */
  prompt: InteractionPrompt | null;
  /** STORY-008. Order ids the owner is carrying, straight off `players[].carrying`. */
  carrying: string[];
  /** STORY-008. The in-progress `interact` action, or null — `players[].currentAction`. */
  currentAction: string | null;
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
    prompt: null,
    carrying: [],
    currentAction: null,
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
      const you = message.you as { ready?: boolean; setup?: AcceptedSetup | null } | null;
      const opponent = players.find((p) => p.playerId !== this.status.playerId);
      const self = players.find((p) => p.playerId === this.status.playerId) as
        | (PlayerState & { carrying?: string[]; currentAction?: string | null })
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
      });
      this.patchStatus({
        playerCount: players.length,
        serverTime: Number(message.serverTime ?? 0),
        // Rendered as received. No local clock — see GameClientStatus.
        matchPhase: (message.matchPhase ?? null) as MatchPhase | null,
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
      });
      return;
    }
    if (message.type === 'match_complete') {
      this.patchStatus({ endReason: (message.reason ?? 'completed') as MatchEndReason });
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
