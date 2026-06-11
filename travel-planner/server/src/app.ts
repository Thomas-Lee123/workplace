import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import authRoutes from './routes/auth';
import tripRoutes from './routes/trips';
import parseRoutes from './routes/parse';
import importRoutes from './routes/import';
import aiRoutes from './routes/ai';
import exportRoutes from './routes/export';
import proxyRoutes from './routes/proxy';

const app = express();

// Trust proxy for rate limiting behind Nginx
app.set('trust proxy', 1);

const allowedOrigins = [
  'https://lsy567.com',
  'http://lsy567.com',
  'http://8.148.24.128',
  'https://8.148.24.128',
  'http://localhost:5173',
  'http://localhost:4173',
];
app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (server-to-server, mobile apps, curl)
    if (!origin || allowedOrigins.includes(origin)) {
      cb(null, true);
    } else {
      cb(new Error('CORS not allowed'));
    }
  },
}));
app.use(express.json());

// General rate limit: 200 req / 15 min per IP
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '请求过于频繁，请稍后再试' },
});

// Strict rate limit for auth endpoints: 10 req / 15 min per IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '登录请求过于频繁，请稍后再试' },
});

app.use('/api/', generalLimiter);
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/trips', tripRoutes);
app.use('/api/parse', parseRoutes);
app.use('/api/import', importRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/proxy', proxyRoutes);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

export default app;
