import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { config } from '../config/index.js';
import { registerSocketHandlers, setSocketServer } from './socket/index.js';
import memoriesRouter from './routes/memories.js';
import healthRouter from './routes/health.js';
import contextRouter from './routes/context.js';
import entitiesRouter from './routes/entities.js';
import consolidationRouter from './routes/consolidation.js';
import summariesRouter from './routes/summaries.js';
import beliefsRouter from './routes/beliefs.js';
import patternsRouter from './routes/patterns.js';
import insightsRouter from './routes/insights.js';
import researchRouter from './routes/research.js';
import graphRouter from './routes/graph.js';
import objectsRouter from './routes/objects.js';
import chatRouter from './routes/chat.js';
import commitmentsRouter from './routes/commitments.js';
import remindersRouter from './routes/reminders.js';
import notificationsRouter from './routes/notifications.js';
import googleRouter from './routes/google.js';
import calendarRouter from './routes/calendar.js';

const app = express();
const httpServer = createServer(app);

// Socket.IO setup with CORS for Next.js dev server
export const io = new SocketIOServer(httpServer, {
  cors: {
    origin: config.server.corsOrigin || 'http://localhost:3000',
    methods: ['GET', 'POST'],
  },
});

// Register Socket.IO event handlers
registerSocketHandlers(io);

// Register io for broadcast functions (used by services)
setSocketServer(io);

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
app.use('/api/patterns', patternsRouter);
app.use('/api/insights', insightsRouter);
app.use('/api/research', researchRouter);
app.use('/api/graph', graphRouter);
app.use('/api/objects', objectsRouter);
app.use('/api/chat', chatRouter);
app.use('/api/commitments', commitmentsRouter);
app.use('/api/reminders', remindersRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/integrations/google', googleRouter);
app.use('/api/calendar', calendarRouter);

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

httpServer.listen(port, () => {
  console.log(`Squire API server running on http://localhost:${port}`);
  console.log(`Health check: http://localhost:${port}/api/health`);
  console.log(`Socket.IO enabled for real-time events`);
});

export default app;
