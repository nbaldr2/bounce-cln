import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import nodesRouter from './routes/nodes';
import listsRouter from './routes/lists';
import resultsRouter from './routes/results';
import dnsRouter from './routes/dns';
import settingsRouter from './routes/settings';
import appSettingsRouter from './routes/appSettings';
import dashboardRouter from './routes/dashboard';
import pmtaRouter from './routes/pmta';
import jobsRouter from './routes/jobs';

import { startScheduledTasks } from './workers/alertWorker';
import { startRetryScheduler } from './workers/retryWorker';

// Import workers so they start listening
import './workers/batchAssigner';
import './workers/retryWorker';
import './workers/alertWorker';

const app = express();
const PORT = parseInt(process.env.API_PORT || '4000', 10);

// ─── Middleware ────────────────────────────────────────────
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Routes ───────────────────────────────────────────────
app.use('/api/nodes', nodesRouter);
app.use('/api/lists', listsRouter);
app.use('/api/results', resultsRouter);
app.use('/api/domains', dnsRouter);
app.use('/api/rate-limits', settingsRouter);
app.use('/api/settings', appSettingsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/pmta', pmtaRouter);
app.use('/api/jobs', jobsRouter);

// Serve static files for deployment (e.g., PMTA installer)
import path from 'path';
app.use('/public', express.static(path.join(__dirname, '../public')));

// Root route
app.get('/', (_req, res) => {
  res.json({
    name: 'Bounce-CLN API',
    status: 'running',
    version: '1.0.0'
  });
});

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Start ────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 Bounce-CLN API running on http://localhost:${PORT}\n`);
  startScheduledTasks().catch(console.error);
  startRetryScheduler().catch(console.error);
});

export default app;
