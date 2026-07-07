import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, tokenStore } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  // Restore session on load if a token is present.
  useEffect(() => {
    let alive = true;
    if (!tokenStore.get()) {
      setReady(true);
      return;
    }
    api
      .me()
      .then((u) => alive && setUser(u))
      .catch(() => alive && tokenStore.clear())
      .finally(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, []);

  // Token invalidated mid-session (api.js dispatches this on a 401).
  useEffect(() => {
    const onExpired = () => setUser(null);
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, []);

  const login = useCallback(async (username, password) => {
    const { token, user } = await api.login(username, password);
    tokenStore.set(token);
    setUser(user);
    return user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      /* ignore */
    }
    tokenStore.clear();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, ready, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
