import { apiFetch } from './api';
import { showToast } from './helpers';

// Ask the server to email the department SPOC the "Audit Report Submitted" mail for a just-saved audit.
// The audit reaches the database through the debounced sync, so the call is retried until the server
// can see it. The server sends at most once per audit, so retries are harmless. Best-effort: the audit
// itself is already saved, so a failure only needs a resend.
export function notifyAuditSubmitted(auditId, deptName, delays = [0, 5000, 15000]) {
  const last = delays.length - 1;
  const attempt = async (i) => {
    try {
      const r = await apiFetch('/api/email/audit-submission', { method: 'POST', body: JSON.stringify({ auditIds: [auditId] }) });
      if (r.missing && r.missing.length && i < last) { setTimeout(() => attempt(i + 1), delays[i + 1] - delays[i]); return; }
      if (r.sent) showToast(`Audit report email sent to ${deptName}`);
      else if (r.missing && r.missing.length) showToast('Audit saved, but the audit report email could not be sent');
    } catch {
      if (i < last) setTimeout(() => attempt(i + 1), delays[i + 1] - delays[i]);
      else showToast('Audit saved, but the audit report email could not be sent');
    }
  };
  setTimeout(() => attempt(0), delays[0]);
}
