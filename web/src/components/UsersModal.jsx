import { useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { generatePassword, copyText } from '../passwords.js';

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
  const [copied, setCopied] = useState('');

  // reset-password panel (per user)
  const [resetFor, setResetFor] = useState(null); // user object
  const [resetPw, setResetPw] = useState('');
  const [resetBusy, setResetBusy] = useState(false);
  const [resetErr, setResetErr] = useState(null);
  const [resetDone, setResetDone] = useState(false);

  const flashCopy = useCallback(async (key, text) => {
    if (await copyText(text)) {
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? '' : c)), 1400);
    }
  }, []);

  const openReset = (u) => {
    setResetFor(u);
    setResetPw(generatePassword());
    setResetErr(null);
    setResetDone(false);
  };

  const applyReset = async () => {
    setResetBusy(true);
    setResetErr(null);
    try {
      await api.resetUserPassword(resetFor.id, resetPw);
      setResetDone(true);
    } catch (e) {
      setResetErr(String(e.message || e));
    } finally {
      setResetBusy(false);
    }
  };

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
              type="text"
              placeholder="password (min 6)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              className="pw-gen"
              title="Generate a secure password"
              onClick={() => setPassword(generatePassword())}
            >
              🎲 Generate
            </button>
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="user">user</option>
              <option value="admin">admin</option>
            </select>
            <button disabled={creating || !username || !password}>
              {creating ? 'Adding…' : '+ Add'}
            </button>
          </div>
          {password && (
            <button
              type="button"
              className={`pw-copy ${copied === 'create' ? 'done' : ''}`}
              onClick={() => flashCopy('create', password)}
            >
              {copied === 'create' ? '✓ copied' : '⧉ copy password'}
            </button>
          )}
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
                      className="reset-btn"
                      title="Reset this user's password"
                      onClick={() => openReset(u)}
                    >
                      Reset PW
                    </button>
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

        {resetFor && (
          <div className="pw-reset-backdrop" onClick={() => setResetFor(null)}>
            <div className="pw-reset" onClick={(e) => e.stopPropagation()}>
              <div className="node-kicker">RESET PASSWORD</div>
              <div className="pw-reset-user">
                for <b>{resetFor.username}</b>
              </div>
              {resetDone ? (
                <>
                  <div className="pw-reset-ok">
                    ✓ Password updated. Share it with the user — their old sessions were signed out.
                  </div>
                  <div className="pw-reset-field">
                    <input readOnly value={resetPw} />
                    <button
                      className={`pw-copy ${copied === 'reset' ? 'done' : ''}`}
                      onClick={() => flashCopy('reset', resetPw)}
                    >
                      {copied === 'reset' ? '✓ copied' : '⧉ copy'}
                    </button>
                  </div>
                  <div className="pw-reset-actions">
                    <button className="pw-gen" onClick={() => setResetFor(null)}>
                      Done
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="pw-reset-field">
                    <input
                      type="text"
                      value={resetPw}
                      onChange={(e) => setResetPw(e.target.value)}
                      placeholder="new password (min 6)"
                    />
                    <button
                      className="pw-gen"
                      title="Generate a secure password"
                      onClick={() => setResetPw(generatePassword())}
                    >
                      🎲
                    </button>
                    <button
                      className={`pw-copy ${copied === 'reset' ? 'done' : ''}`}
                      onClick={() => flashCopy('reset', resetPw)}
                    >
                      {copied === 'reset' ? '✓' : '⧉'}
                    </button>
                  </div>
                  {resetErr && <div className="login-error">⚠ {resetErr}</div>}
                  <div className="pw-reset-actions">
                    <button className="del-btn" onClick={() => setResetFor(null)}>
                      Cancel
                    </button>
                    <button
                      className="pw-apply"
                      disabled={resetBusy || resetPw.length < 6}
                      onClick={applyReset}
                    >
                      {resetBusy ? 'Saving…' : 'Set password'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
