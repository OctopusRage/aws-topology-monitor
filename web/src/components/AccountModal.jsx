import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';

export default function AccountModal({ onClose }) {
  const { user } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (next !== confirm) {
      setError('new passwords do not match');
      return;
    }
    setBusy(true);
    try {
      await api.changePassword(current, next);
      setDone(true);
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal account-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="node-kicker">ACCOUNT</div>
            <h2>{user?.username}</h2>
            <div className="modal-sub">
              <span className={`role-badge ${user?.role}`}>{user?.role}</span>
            </div>
          </div>
          <button className="close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <form className="account-form" onSubmit={submit}>
          <div className="node-kicker">CHANGE PASSWORD</div>

          <label className="login-field">
            <span>Current password</span>
            <input
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
            />
          </label>
          <label className="login-field">
            <span>New password (min 6)</span>
            <input
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              autoComplete="new-password"
            />
          </label>
          <label className="login-field">
            <span>Confirm new password</span>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
            />
          </label>

          {error && <div className="login-error">⚠ {error}</div>}
          {done && <div className="account-ok">✓ Password updated</div>}

          <button
            className="login-btn"
            disabled={busy || !current || !next || !confirm}
          >
            {busy ? 'Updating…' : 'Update password'}
          </button>
        </form>
      </div>
    </div>
  );
}
