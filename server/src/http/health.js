// PRD §13 "Suggested HTTP endpoints": /health for deployment and service health.

import { Router } from 'express';

export function healthRouter() {
  const router = Router();
  const startedAt = Date.now();

  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptimeMs: Date.now() - startedAt });
  });

  return router;
}
