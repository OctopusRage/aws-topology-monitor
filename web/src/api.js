const base = '';

async function get(path) {
  const res = await fetch(base + path);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  health: () => get('/api/health'),
  listElbs: () => get('/api/elbs'),
  topology: (lbArn) => get(`/api/topology?lbArn=${encodeURIComponent(lbArn)}`),
  targetGroupMetrics: (tgArn, range, lbArn) =>
    get(
      `/api/metrics/target-group?tgArn=${encodeURIComponent(tgArn)}&range=${range}` +
        (lbArn ? `&lbArn=${encodeURIComponent(lbArn)}` : '')
    ),
};
