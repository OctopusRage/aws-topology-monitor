// User + session data access.
import { db } from './db.js';
import { hashPassword, verifyPassword, newToken } from './auth.js';

function parseDefaultView(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const publicUser = (u) =>
  u && {
    id: u.id,
    username: u.username,
    role: u.role,
    created_at: u.created_at,
    defaultView: parseDefaultView(u.default_view),
  };

export function findByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

export function listUsers() {
  return db
    .prepare('SELECT id, username, role, created_at FROM users ORDER BY id')
    .all();
}

export function createUser(username, password, role = 'user') {
  const uname = String(username || '').trim();
  if (uname.length < 3) throw new Error('username must be at least 3 characters');
  if (String(password || '').length < 6)
    throw new Error('password must be at least 6 characters');
  if (role !== 'admin' && role !== 'user') throw new Error('invalid role');
  if (findByUsername(uname)) throw new Error('username already exists');

  const info = db
    .prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
    .run(uname, hashPassword(password), role);
  return publicUser(
    db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid)
  );
}

export function deleteUser(id) {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
}

export function countAdmins() {
  return db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n;
}

export function changePassword(userId, current, next) {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!u || !verifyPassword(current, u.password_hash))
    throw new Error('current password is incorrect');
  if (String(next || '').length < 6)
    throw new Error('new password must be at least 6 characters');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(
    hashPassword(next),
    userId
  );
}

// Admin resets another user's password (no current-password check). Existing
// sessions are revoked so the user must sign in again with the new password.
export function adminSetPassword(userId, next) {
  const u = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!u) throw new Error('user not found');
  if (String(next || '').length < 6)
    throw new Error('new password must be at least 6 characters');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(
    hashPassword(next),
    userId
  );
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

// ---- auth flows ----
export function login(username, password) {
  const u = findByUsername(String(username || '').trim());
  if (!u || !verifyPassword(password, u.password_hash)) return null;
  const token = newToken();
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, u.id);
  return { token, user: publicUser(u) };
}

export function logout(token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function getUserByToken(token) {
  const row = db
    .prepare(
      `SELECT u.id, u.username, u.role, u.created_at, u.default_view
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`
    )
    .get(token);
  return publicUser(row);
}

export function setDefaultView(userId, value) {
  db.prepare('UPDATE users SET default_view = ? WHERE id = ?').run(
    value ? JSON.stringify(value) : null,
    userId
  );
}
