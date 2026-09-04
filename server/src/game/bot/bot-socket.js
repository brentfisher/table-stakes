// A duck-typed stand-in for the `ws` library's WebSocket, sized to exactly the surface
// `connection-manager.js` and `socket-server.js` touch: `readyState`, `OPEN`, and `send()`.
// Registering one of these through `connections.register()` and driving it with
// `message-router.js#routeMessage()` is indistinguishable, from the server's point of view,
// from a real browser socket — see `bot-controller.js`'s header for why that is the whole
// point of STORY-017's design.
//
// WHY NOT A REAL NETWORK SOCKET. The bot lives inside the same process that already owns the
// match; opening a real loopback WebSocket back to itself would need to know its own listening
// port, tolerate real network latency inside an otherwise-deterministic simulation, and
// reconnect-handle a connection to itself. None of that buys anything STORY-017's acceptance
// criteria ask for — "the bot is a client from the server's point of view" (conventions.md
// Notable Pattern 1) is about which CODE PATH an action takes (message-router.js's validators,
// never a shortcut around them), not about which OS socket carries the bytes. This object makes
// that code path byte-for-byte identical (every message is still JSON.stringify'd and
// JSON.parse'd exactly as `routeMessage` expects from a real `data.toString()`) while staying
// entirely in-process — which is what lets the bot be driven by synthetic `dtMs` rather than
// wall-clock timing (see `bot-controller.js#advance`), and that in turn is what makes a bot
// match reproducible from its seed (STORY-017 AC5).

const READY_STATE_OPEN = 1;
const READY_STATE_CLOSED = 3;

export class BotSocket {
  /** @param {(raw: string) => void} onSend  called with the JSON string the "server" sends back,
   *                                          exactly as a real `ws` instance's `send()` would. */
  constructor(onSend) {
    this.readyState = READY_STATE_OPEN;
    // `connection-manager.js#send`/`broadcast`/`broadcastPerViewer` all gate on `ws.readyState
    // === ws.OPEN` — the real `ws` library exposes `OPEN` as an instance property (mirroring
    // the browser WebSocket constant), so this object does too rather than a shared static.
    this.OPEN = READY_STATE_OPEN;
    this._onSend = onSend;
  }

  send(data) {
    if (this.readyState !== READY_STATE_OPEN) return;
    this._onSend(typeof data === 'string' ? data : String(data));
  }

  close() {
    this.readyState = READY_STATE_CLOSED;
  }
}
