// ── API FETCH WRAPPER ─────────────────────────────────
// Authentication is a httpOnly session cookie managed by Auth.js on the server, so the
// browser never handles (or can leak via XSS) a token. fetch() sends the cookie
// automatically for same-origin requests.
import { showToast } from './helpers';
export const AUDITPRO_CLIENT_VERSION = 'AuditPro-Web/2026-11-02-server-mail';

let staleWarned = false;

export async function apiFetch(path, opts = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'X-AuditPro-Client': AUDITPRO_CLIENT_VERSION,
    ...(opts.headers || {}),
  };
  const res = await fetch(path, { credentials: 'same-origin', ...opts, headers });
  // The server flags a tab that is still running an older build of the portal. Such a tab can miss new
  // behaviour (for example the audit report email), so ask the user to refresh, once.
  if (!staleWarned && res.headers.get('X-AuditPro-Client-Warning')) {
    staleWarned = true;
    showToast('A newer version of AuditPro is available. Save your work and press Ctrl+F5 to refresh this page.', 12000);
  }
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok || data.ok === false) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}
