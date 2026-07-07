const TOKEN_KEY = 'authToken';

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

async function req(path, opts = {}) {
  const token = tokenStore.get();
  const res = await fetch(path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (res.status === 401 && token) {
    // token no longer valid — drop it and let the app fall back to login
    tokenStore.clear();
    window.dispatchEvent(new Event('auth:expired'));
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

const get = (p) => req(p);
const post = (p, body) => req(p, { method: 'POST', body: JSON.stringify(body) });
const put = (p, body) => req(p, { method: 'PUT', body: JSON.stringify(body) });
const del = (p) => req(p, { method: 'DELETE' });

export const api = {
  // auth
  login: (username, password) => post('/api/auth/login', { username, password }),
  logout: () => post('/api/auth/logout', {}),
  me: () => get('/api/auth/me'),
  changePassword: (currentPassword, newPassword) =>
    post('/api/auth/password', { currentPassword, newPassword }),
  setDefaultView: (defaultView) => put('/api/auth/default-view', { defaultView }),
  // users (admin)
  listUsers: () => get('/api/users'),
  createUser: (username, password, role) =>
    post('/api/users', { username, password, role }),
  deleteUser: (id) => del(`/api/users/${id}`),
  // topology + metrics
  health: () => get('/api/health'),
  listElbs: () => get('/api/elbs'),
  topology: (lbArn) => get(`/api/topology?lbArn=${encodeURIComponent(lbArn)}`),
  targetGroupMetrics: (tgArn, range, lbArn) =>
    get(
      `/api/metrics/target-group?tgArn=${encodeURIComponent(tgArn)}&range=${range}` +
        (lbArn ? `&lbArn=${encodeURIComponent(lbArn)}` : '')
    ),
  // data points + saved views
  listDatasources: () => get('/api/datasources'),
  datapointMetrics: (datapoint, range) =>
    post('/api/metrics/datapoint', { datapoint, range }),
  rdsTopQueries: (dbInstanceId, range) =>
    get(
      `/api/rds/top-queries?dbInstanceId=${encodeURIComponent(dbInstanceId)}&range=${range}`
    ),
  listViews: () => get('/api/views'),
  getView: (id) => get(`/api/views/${id}`),
  createView: (payload) => post('/api/views', payload),
  updateView: (id, payload) => put(`/api/views/${id}`, payload),
  deleteView: (id) => del(`/api/views/${id}`),
};
