import { config } from '../lib/config.js';

export function isAllowedOrigin(origin) {
  if (!origin) return config.NODE_ENV !== 'production';
  return config.origins.includes(origin);
}

export function requireAllowedOrigin(req, res, next) {
  const origin = req.get('origin');
  if (!origin) return next();

  if (!isAllowedOrigin(origin)) {
    return res.status(403).json({ error: 'origin_not_allowed' });
  }
  return next();
}
