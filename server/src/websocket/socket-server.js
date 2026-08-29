// Attaches a `ws` server to the existing HTTP server. PRD §13: Express hosts the HTTP API
// and the static client; ws handles the low-overhead game connections.

import { WebSocketServer } from 'ws';
import * as connections from './connection-manager.js';
import { routeMessage } from './message-router.js';
import * as matchManager from '../game/match-manager.js';

export function attachSocketServer(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws) => {
    const record = connections.register(ws);
    console.log(`[ws] connected ${record.playerId}`);

    ws.on('message', (data) => routeMessage(ws, data.toString()));
    ws.on('close', () => {
      const closed = connections.unregister(ws, { getRoom: matchManager.getRoom });
      if (closed) console.log(`[ws] disconnected ${closed.playerId}`);
    });
    ws.on('error', (err) => console.error('[ws] socket error', err.message));
  });

  console.log('[ws] websocket server attached at /ws');
  return wss;
}

export { connections };
