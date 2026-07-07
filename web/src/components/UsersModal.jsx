import { useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';

export default function UsersModal({ onClose }) {
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  // create form
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('user');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setUsers(await api.listUsers());
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = async (e) => {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      await api.createUser(username, password, role);
      setUsername('');
      setPassword('');
      setRole('user');
      await load();
    } catch (err) {
      setCreateError(String(err.message || err));
    } finally {
      setCreating(false);
    }
  };

  const remove = async (u) => {
    if (!window.confirm(`Delete user "${u.username}"?`)) return;
    try {
      await api.deleteUser(u.id);
      await load();
    } catch (err) {
      setError(String(err.message || err));
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal users-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="node-kicker">ADMIN</div>
            <h2>User management</h2>
            <div className="modal-sub">Create and manage accounts</div>
          </div>
          <button className="close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <form className="user-create" onSubmit={create}>
          <div className="node-kicker">CREATE USER</div>
          <div className="user-create-row">
            <input
              placeholder="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <input
              type="password"
              placeholder="password (min 6)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="user">user</option>
              <option value="admin">admin</option>
            </select>
            <button disabled={creating || !username || !password}>
              {creating ? 'Adding…' : '+ Add'}
            </button>
          </div>
          {createError && <div className="login-error">⚠ {createError}</div>}
        </form>

        {error && <div className="modal-error">⚠ {error}</div>}

        <div className="user-list">
          <div className="node-kicker">
            ACCOUNTS {loading ? '· loading…' : `· ${users.length}`}
          </div>
          <table className="user-table">
            <thead>
              <tr>
                <th>Username</th>
                <th>Role</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    {u.username}
                    {u.id === me.id && <span className="you-tag">you</span>}
                  </td>
                  <td>
                    <span className={`role-badge ${u.role}`}>{u.role}</span>
                  </td>
                  <td className="muted">{u.created_at}</td>
                  <td className="right">
                    <button
                      className="del-btn"
                      disabled={u.id === me.id}
                      title={u.id === me.id ? 'You cannot delete yourself' : 'Delete'}
                      onClick={() => remove(u)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
