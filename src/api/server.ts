import express from 'express';
import { config } from '../config/index.js';
import memoriesRouter from './routes/memories.js';
import healthRouter from './routes/health.js';

const app = express();

// Middleware
app.use(express.json());

// Routes
app.use('/api/health', healthRouter);
app.use('/api/memories', memoriesRouter);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const port = config.server.port;

app.listen(port, () => {
  console.log(`Squier API server running on http://localhost:${port}`);
  console.log(`Health check: http://localhost:${port}/api/health`);
});

export default app;
