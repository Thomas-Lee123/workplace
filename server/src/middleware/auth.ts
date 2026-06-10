import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'dev-secret');
if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET 未设置！生产环境必须配置环境变量');
  process.exit(1);
} else if (JWT_SECRET === 'dev-secret') {
  console.warn('WARNING: 使用了默认 JWT_SECRET，生产环境请配置环境变量！');
}

export interface AuthRequest extends Request {
  userId?: string;
}

export function auth(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: '未登录' });
    return;
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { userId: string };
    req.userId = payload.userId;
    next();
  } catch {
    res.status(401).json({ error: '登录已过期，请重新登录' });
  }
}
