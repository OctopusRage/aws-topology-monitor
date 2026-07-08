// Saved views — created & edited by admins, visible to everyone (regular users
// load them read-only). Non-admins only see views authored by an admin.
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

export function listViews(user) {
  const rows = db
    .prepare(
      `SELECT v.id, v.name, v.base_lb_arn, v.created_by, v.created_by_name, v.updated_at,
              u.role AS creator_role
       FROM saved_views v LEFT JOIN users u ON u.id = v.created_by
       ORDER BY v.updated_at DESC`
    )
    .all();
  const visible =
    user?.role === 'admin' ? rows : rows.filter((r) => r.creator_role === 'admin');
  return visible.map((r) => ({
    id: r.id,
    name: r.name,
    baseLbArn: r.base_lb_arn,
    createdBy: r.created_by,
    createdByName: r.created_by_name,
    updatedAt: r.updated_at,
  }));
}

export function getView(id) {
  const row = db
    .prepare(
      `SELECT v.*, u.role AS creator_role
       FROM saved_views v LEFT JOIN users u ON u.id = v.created_by
       WHERE v.id = ?`
    )
    .get(id);
  if (!row) return null;
  const v = parse(row);
  v.creatorRole = row.creator_role;
  return v;
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
