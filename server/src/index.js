// Server entry point. PRD §13: a vanilla Express JavaScript app that serves the built
// client and the HTTP API, with `ws` attached to the same HTTP server for game traffic.
//
// Boot order matters. `./game/catalogue.js` is imported (via routes and match) before the
// listener opens, so a malformed shared/game-data catalogue aborts startup with every problem
// listed rather than surfacing as a broken match later (Decision 9). Systems are registered
// before the loop starts, so the boot log names exactly what will run.

import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { healthRouter } from './http/health.js';
import { apiRouter } from './http/routes.js';
import { attachSocketServer } from './websocket/socket-server.js';
import { broadcast, broadcastPerViewer } from './websocket/connection-manager.js';
import { startSimulationLoop, registeredSystems } from './game/simulation-loop.js';
import { registerAllSystems } from './game/systems/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);

const app = express();
app.use(express.json());

app.use(healthRouter());
app.use('/api', apiRouter());

// Serve the built client. `npm run build:client` writes here.
const clientBuildDir = join(here, '../public/client-build');
app.use(express.static(clientBuildDir));

/**
 * STORY-023/024. `router.ts`'s client-side routes (`/join/:token`, `/lobby/:roomId`,
 * `/game/:roomId`, etc.) have no matching file under `client-build/` — a fresh tab opening one
 * of them is exactly a guest's FIRST request, not a follow-up to an already-loaded app, so there
 * is no earlier page load to have parsed the URL. This is the standard SPA-with-client-routing
 * fallback: any GET that `express.static` above did not already answer with a real file, and
 * that is not under `/api`, gets the app shell so `App.tsx`'s own pathname switch can take
 * over. Restricted to GET-and-not-`/api` so a genuinely bad API path still reaches Express's
 * normal 404 rather than silently returning HTML for it.
 */
app.get(/^\/(?!api\/).*/, (_req, res) => {
  res.sendFile(join(clientBuildDir, 'index.html'));
});

const httpServer = createServer(app);
attachSocketServer(httpServer);

registerAllSystems();
console.log(`[boot] systems registered: ${registeredSystems().map((s) => s.id).join(', ')}`);
startSimulationLoop({ broadcast, broadcastPerViewer });

httpServer.listen(PORT, () => {
  console.log(`[http] listening on http://localhost:${PORT}`);
});

export { app, httpServer };
