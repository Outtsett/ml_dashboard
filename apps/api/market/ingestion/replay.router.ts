import { Router, type Request, type Response } from 'express';

const router = Router();

router.get('/market/replay/status', async (_req: Request, res: Response) => {
  res.json({
    running: false,
    source: null,
    description: null,
    liveFeed: { table: 'unknown', writing: false, error: 'Replay disabled (backend transitioned from legacy db)' },
  });
});

router.post('/market/replay/start', async (_req: Request, res: Response) => {
  res.status(400).json({ error: 'Replay is not available in the current backend architecture.' });
});

router.post('/market/replay/stop', (_req: Request, res: Response) => {
  res.json({ running: false, stopped: null });
});

export default router;
