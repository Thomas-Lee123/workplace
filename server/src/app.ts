import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth';
import tripRoutes from './routes/trips';
import parseRoutes from './routes/parse';
import importRoutes from './routes/import';
import aiRoutes from './routes/ai';
import exportRoutes from './routes/export';

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/trips', tripRoutes);
app.use('/api/parse', parseRoutes);
app.use('/api/import', importRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/export', exportRoutes);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

export default app;
