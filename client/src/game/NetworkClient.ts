// Native browser WebSocket transport. PRD §13: "Native browser WebSocket API" — no
// socket.io, no wrapper library. JSON messages per PRD §12.

export type ServerMessage = Record<string, unknown> & { type: string };

export class NetworkClient {
  private socket: WebSocket | null = null;
  private sequence = 0;

  onMessage: ((message: ServerMessage) => void) | null = null;
  onStatusChange: ((status: 'connecting' | 'open' | 'closed') => void) | null = null;

  connect(url = NetworkClient.defaultUrl()): void {
    this.onStatusChange?.('connecting');
    const socket = new WebSocket(url);
    this.socket = socket;

    socket.addEventListener('open', () => this.onStatusChange?.('open'));
    socket.addEventListener('close', () => this.onStatusChange?.('closed'));
    socket.addEventListener('error', () => this.onStatusChange?.('closed'));
    socket.addEventListener('message', (event) => {
      try {
        this.onMessage?.(JSON.parse(event.data as string) as ServerMessage);
      } catch {
        // A malformed frame is a server bug; drop it rather than killing the render loop.
      }
    });
  }

  static defaultUrl(): string {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws`;
  }

  get isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  send(message: Record<string, unknown>): void {
    if (!this.isOpen) return;
    this.socket?.send(JSON.stringify(message));
  }

  /**
   * `playerId` is the reconnect token from a previous `joined` message. The server honours it
   * only for a player who dropped and is still inside the reconnect grace window; a fresh
   * client omits it. Reconnect *UX* — when to retry, what to show meanwhile — is STORY-022.
   */
  joinRoom(roomId?: string, playerId?: string): void {
    this.send({
      type: 'join_room',
      ...(roomId ? { roomId } : {}),
      ...(playerId ? { playerId } : {}),
    });
  }

  /** PRD §12 client-to-server `player_input`. Intent only — never a position. */
  sendInput(move: { x: number; z: number; sprint: boolean }, facing: number): void {
    this.sequence += 1;
    this.send({ type: 'player_input', sequence: this.sequence, move, facing });
  }

  /** PRD §12 room-flow step 7. Accepted by the server during `lobby` and `setup`. */
  sendReady(ready = true): void {
    this.send({ type: 'player_ready', ready });
  }

  /**
   * PRD §12 client-to-server example 4. Note there is no `sequence`: this is a one-shot phase
   * submission, not a per-tick intent. The server answers either with the next snapshot
   * (carrying the accepted menu under `you.setup`) or with an `error` whose `error` is
   * `setup_rejected` and whose `reason` names which rule was broken.
   */
  sendSetupSubmit(payload: Record<string, unknown>): void {
    this.send({ type: 'setup_submit', ...payload });
  }

  disconnect(): void {
    this.socket?.close();
    this.socket = null;
  }
}
