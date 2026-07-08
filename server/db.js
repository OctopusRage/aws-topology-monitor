// SQLite persistence (Node's built-in node:sqlite — no native deps).
// Holds users and login sessions.
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from './config.js';
import { hashPassword } from './auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || join(__dirname, 'data.db');

export const db = new DatabaseSync(dbPath);

// Tuning for small / slow-disk servers. WAL lets the per-request auth reads run
// concurrently with writes instead of blocking on a whole-db lock; NORMAL drops
// the fsync-per-transaction that makes each save slow on cheap disks; the busy
// timeout waits briefly for a lock instead of erroring. This removes most of the
// "lag when saving / creating a user" on constrained hosts.
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA synchronous = NORMAL');
db.exec('PRAGMA busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS saved_views (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    base_lb_arn TEXT NOT NULL,
    data TEXT NOT NULL DEFAULT '{}',
    created_by INTEGER,
    created_by_name TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
  );
`);

// Migration: per-user startup view preference.
const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
if (!userCols.includes('default_view')) {
  db.exec('ALTER TABLE users ADD COLUMN default_view TEXT');
}

// Seed a default admin on first run so someone can log in.
const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
if (count === 0) {
  db.prepare(
    'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)'
  ).run(config.admin.username, hashPassword(config.admin.password), 'admin');
  console.log(
    `[db] seeded default admin "${config.admin.username}" — change the password after first login`
  );
}
