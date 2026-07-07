// Saved views — SHARED across all users. Any logged-in user can see and load
// them; only the creator or an admin can edit or delete.
import { db } from './db.js';

function parse(row) {
  if (!row) return null;
  let data = {};
  try {
    data = JSON.parse(row.data);
  } catch {
    data = {};
  }
  return {
    id: row.id,
    name: row.name,
    baseLbArn: row.base_lb_arn,
    data, // { datapoints: [...], connections: [...] }
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listViews() {
  return db
    .prepare(
      `SELECT id, name, base_lb_arn, created_by, created_by_name, updated_at
       FROM saved_views ORDER BY updated_at DESC`
    )
    .all()
    .map((r) => ({
      id: r.id,
      name: r.name,
      baseLbArn: r.base_lb_arn,
      createdBy: r.created_by,
      createdByName: r.created_by_name,
      updatedAt: r.updated_at,
    }));
}

export function getView(id) {
  return parse(db.prepare('SELECT * FROM saved_views WHERE id = ?').get(id));
}

export function createView(user, { name, baseLbArn, data }) {
  if (!String(name || '').trim()) throw new Error('name is required');
  if (!baseLbArn) throw new Error('baseLbArn is required');
  const info = db
    .prepare(
      `INSERT INTO saved_views (name, base_lb_arn, data, created_by, created_by_name)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(name.trim(), baseLbArn, JSON.stringify(data || {}), user.id, user.username);
  return getView(info.lastInsertRowid);
}

function canEdit(row, user) {
  return user.role === 'admin' || row.created_by === user.id;
}

export function updateView(id, user, { name, baseLbArn, data }) {
  const row = db.prepare('SELECT * FROM saved_views WHERE id = ?').get(id);
  if (!row) throw new Error('view not found');
  if (!canEdit(row, user)) throw new Error('only the creator or an admin can edit this view');
  db.prepare(
    `UPDATE saved_views
     SET name = ?, base_lb_arn = ?, data = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    name ?? row.name,
    baseLbArn ?? row.base_lb_arn,
    JSON.stringify(data ?? JSON.parse(row.data)),
    id
  );
  return getView(id);
}

export function deleteView(id, user) {
  const row = db.prepare('SELECT * FROM saved_views WHERE id = ?').get(id);
  if (!row) throw new Error('view not found');
  if (!canEdit(row, user)) throw new Error('only the creator or an admin can delete this view');
  db.prepare('DELETE FROM saved_views WHERE id = ?').run(id);
}
