import express from 'express';
import { config } from '../config/index.js';
import memoriesRouter from './routes/memories.js';
import healthRouter from './routes/health.js';
import contextRouter from './routes/context.js';
import entitiesRouter from './routes/entities.js';
import consolidationRouter from './routes/consolidation.js';
import summariesRouter from './routes/summaries.js';
import beliefsRouter from './routes/beliefs.js';

const app = express();

// Middleware
app.use(express.json());

// Routes
app.use('/api/health', healthRouter);
app.use('/api/memories', memoriesRouter);
app.use('/api/context', contextRouter);
app.use('/api/entities', entitiesRouter);
app.use('/api/consolidation', consolidationRouter);
app.use('/api/summaries', summariesRouter);
app.use('/api/beliefs', beliefsRouter);

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
  console.log(`Squire API server running on http://localhost:${port}`);
  console.log(`Health check: http://localhost:${port}/api/health`);
});

export default app;
