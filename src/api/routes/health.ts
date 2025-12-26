import { Router, Request, Response } from 'express';
import { checkConnection } from '../../db/pool.js';

const router = Router();

/**
 * GET /api/health
 * Health check endpoint
 */
router.get('/', async (_req: Request, res: Response): Promise<void> => {
  const dbHealthy = await checkConnection();

  const status = {
    status: dbHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    database: dbHealthy ? 'connected' : 'disconnected',
    version: '0.1.0',
  };

  res.status(dbHealthy ? 200 : 503).json(status);
});

export default router;
