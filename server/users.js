// User + session data access.
import { db } from './db.js';
import { hashPassword, verifyPassword, newToken } from './auth.js';

const publicUser = (u) =>
  u && { id: u.id, username: u.username, role: u.role, created_at: u.created_at };

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
      `SELECT u.id, u.username, u.role, u.created_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`
    )
    .get(token);
  return row || null;
}
