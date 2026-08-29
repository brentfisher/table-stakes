export declare const CLIENT_MESSAGE_TYPES: readonly string[];
export declare const SERVER_MESSAGE_TYPES: readonly string[];
export declare const IMPLEMENTED_CLIENT_MESSAGE_TYPES: readonly string[];

export interface PlayerInputMessage {
  type: 'player_input';
  sequence: number;
  move: { x: number; z: number; sprint: boolean };
  facing: number;
}

export interface PlayerSnapshot {
  playerId: string;
  position: { x: number; y: number; z: number };
  facing: number;
  sprinting: boolean;
  lastSequence: number;
}

export interface MatchSnapshotMessage {
  type: 'match_snapshot';
  serverTime: number;
  matchPhase: string;
  timeRemainingMs: number | null;
  events: unknown[];
  restaurants: unknown[];
  customers: unknown[];
  orders: unknown[];
  players: PlayerSnapshot[];
}
