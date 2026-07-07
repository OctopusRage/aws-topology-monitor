// Authentication helpers — scrypt password hashing + opaque DB-backed session
// tokens (revocable on logout). No external dependencies.
import crypto from 'node:crypto';

// ---- password hashing (scrypt) ----
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64);
  const known = Buffer.from(hash, 'hex');
  return test.length === known.length && crypto.timingSafeEqual(test, known);
}

export function newToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ---- middleware factories (need the db + queries; injected to avoid cycles) ----
export function makeAuthMiddleware(getUserByToken) {
  function bearer(req) {
    const h = req.headers.authorization || '';
    return h.startsWith('Bearer ') ? h.slice(7) : null;
  }

  const requireAuth = (req, res, next) => {
    const token = bearer(req);
    const user = token && getUserByToken(token);
    if (!user) return res.status(401).json({ error: 'unauthorized' });
    req.user = user;
    next();
  };

  const requireAdmin = (req, res, next) => {
    if (req.user?.role !== 'admin')
      return res.status(403).json({ error: 'admin only' });
    next();
  };

  return { requireAuth, requireAdmin };
}
