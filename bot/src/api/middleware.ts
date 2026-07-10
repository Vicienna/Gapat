import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) return res.status(401).json({ error: 'Unauthorized' });
  const auth = req.headers['x-api-secret'];
  if (typeof auth !== 'string') return res.status(401).json({ error: 'Unauthorized' });
  try {
    const a = Buffer.from(auth, 'utf8');
    const b = Buffer.from(secret, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Extract user info from dashboard proxy headers
  const userId = req.headers['x-user-id'];
  const userRole = req.headers['x-user-role'];
  if (userId) {
    (req as any).user = {
      userId: String(userId),
      role: String(userRole || 'user'),
    };
  }

  next();
}

export function ownerOnly(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;
  if (!user || user.role !== 'owner') {
    return res.status(403).json({ error: 'Owner access required' });
  }
  next();
}
