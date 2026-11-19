// ── SYNC KEYS ───────────────────────────────────────
// Server-side whitelist of keys the /api/sync endpoints accept. All app data lives
// only in MongoDB + in-memory React state — nothing here is cached in localStorage.
export const SYNC_KEYS = [
  'ap_users','ap_depts','ap_auds','ap_cps','ap_finds','ap_learns',
  'ap_completed_audits','ap_planned_audits','ap_import_logs','ap_capa_due',
  'ap_notifs','ap_permissions','ap_email_master','ap_system_settings',
  'ap_email_templates','ap_email_logs','ap_required_cc_emails','ap_root_causes',
  'ap_media_library','ap_escalation_matrix','ap_audit_drafts','ap_local_storage_backup',
  'ap_email_rules',
];

// ── SANITIZE ─────────────────────────────────────────
export function sanitize(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#x27;');
}

// ── DATES ────────────────────────────────────────────
export function parseAuditDate(raw) {
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}
export function fmtDate(raw) {
  const d = parseAuditDate(raw);
  if (!d) return '—';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
export function fmtDateTime(raw) {
  const d = parseAuditDate(raw);
  if (!d) return '—';
  return d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}
export function today() {
  return new Date().toISOString().slice(0, 10);
}

// ── FINDING UTILS ─────────────────────────────────────
export const SEV_BADGE = { critical:'b-red', major:'b-amber', minor:'b-teal', obs:'b-purple' };
export const SEV_LABEL = { critical:'Critical', major:'Major', minor:'Minor', obs:'Observation' };
export const STAT_BADGE = { open:'b-red', 'in-progress':'b-amber', delayed:'b-red', closed:'b-green', 'pending-closure':'b-purple' };
export const STAT_LABEL = { open:'Open', 'in-progress':'In Progress', delayed:'Delayed', closed:'Closed', 'pending-closure':'Submit For Review' };
export const ROLE_COLORS = { admin:'#7c3aed', auditor:'#2563eb', spoc:'#16a34a', manager:'#d97706', viewer:'#6b7280' };
export const ROLE_LABELS = { admin:'Master Admin', auditor:'Auditor', spoc:'Dept SPOC', manager:'Manager', viewer:'Mgmt Viewer' };
export const ROLE_BADGE  = { admin:'b-purple', auditor:'b-blue', spoc:'b-green', manager:'b-amber', viewer:'b-gray' };

export function findingWorkflowStatus(f) {
  if (!f) return '';
  const status = String(f.status || '').toLowerCase();
  const capa = String(f.capaStatus || '').toLowerCase();
  if (status === 'closed' || capa === 'closed') return 'closed';
  if (status === 'pending-closure') return 'pending-closure';
  // capaStatus is consulted only when status carries no explicit workflow state.
  // A rejected closure is reopened by moving status off 'pending-closure', so trusting
  // a stale capaStatus:'submitted' here would pin it to "Submit For Review" forever.
  if (capa === 'submitted' && (!status || status === 'open')) return 'pending-closure';
  return status || capa || 'open';
}

export function normalizeFindingsData(data) {
  if (!Array.isArray(data)) return { value: [], changed: !!data };
  const seen = new Set(); let changed = false;
  const value = data.map((raw, idx) => {
    const f = (raw && typeof raw === 'object') ? raw : {};
    const updates = {};
    const id = String(f.id || '').trim();
    if (!id || seen.has(id)) { updates.id = `find_${idx}_${Date.now()}`; changed = true; } else seen.add(id);
    if (!String(f.ref || '').trim()) { updates.ref = updates.id || id; changed = true; }
    if (!String(f.status || '').trim()) { updates.status = 'open'; changed = true; }
    if (!String(f.capaStatus || '').trim()) { updates.capaStatus = f.status || 'open'; changed = true; }
    if (!Array.isArray(f.activityLog)) { updates.activityLog = []; changed = true; }
    return Object.keys(updates).length ? Object.assign({}, f, updates) : f;
  });
  return { value, changed };
}

// ── PERMISSIONS ──────────────────────────────────────
export const DEFAULT_PERMS = {
  admin:   { ocp:1,dashboard:1,analytics:1,planning:1,execution:1,reports:1,findings:1,capa:1,learnings:1,media:1,masterdata:1,adminpanel:1,mytasks:1,managerpanel:1,mastertracker:1,importdata:1,emailcenter:1 },
  auditor: { ocp:1,dashboard:1,analytics:1,planning:1,execution:1,reports:1,findings:1,capa:1,learnings:1,media:1,masterdata:0,adminpanel:0,mytasks:1,managerpanel:1,mastertracker:1,importdata:1,emailcenter:0 },
  spoc:    { ocp:1,dashboard:1,analytics:1,planning:0,execution:0,reports:1,findings:1,capa:1,learnings:1,media:1,masterdata:0,adminpanel:0,mytasks:1,managerpanel:0,mastertracker:1,importdata:0,emailcenter:0 },
  manager: { ocp:1,dashboard:1,analytics:1,planning:0,execution:0,reports:1,findings:1,capa:1,learnings:1,media:1,masterdata:0,adminpanel:0,mytasks:1,managerpanel:1,mastertracker:1,importdata:0,emailcenter:0 },
  viewer:  { ocp:1,dashboard:1,analytics:1,planning:0,execution:0,reports:1,findings:1,capa:0,learnings:0,media:1,masterdata:0,adminpanel:0,mytasks:1,managerpanel:0,mastertracker:0,importdata:0,emailcenter:0 },
};
export function loadPermissions(saved) {
  const roles = (saved && saved.roles) || saved || {};
  const base = JSON.parse(JSON.stringify(DEFAULT_PERMS));
  if (roles && typeof roles === 'object') {
    Object.keys(base).forEach(role => {
      if (!roles[role] || typeof roles[role] !== 'object') return;
      Object.keys(base[role]).forEach(page => {
        if (Object.prototype.hasOwnProperty.call(roles[role], page)) base[role][page] = roles[role][page] ? 1 : 0;
      });
    });
  }
  base.admin = Object.keys(base.admin).reduce((a, p) => { a[p] = 1; return a; }, {});
  return base;
}

// ── MEDIA / EVIDENCE FILE HELPERS ────────────────────
export function mediaUrl(f) { return f ? (f.secure_url || f.url || f.data || '') : ''; }
export function isImageMedia(f) {
  const u = mediaUrl(f);
  return !!(f && (f.resource_type === 'image' || f.file_type === 'image' || /^data:image/i.test(u) || /\.(png|jpe?g|webp|gif)(\?|#|$)/i.test(u)));
}

// ── GENERATE ID ──────────────────────────────────────
export function genId(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// ── MANAGER DEPT CODES ───────────────────────────────
// ── AUDIT SCORE ──────────────────────────────────────
export function auditScore(findings = []) {
  let score = 100;
  findings.forEach(f => {
    const sev = String(f.sev || f.severity || 'obs').toLowerCase();
    if (sev.includes('critical')) score -= 15;
    else if (sev.includes('major')) score -= 10;
    else if (sev.includes('minor')) score -= 5;
    else score -= 2;
  });
  return Math.min(100, Math.max(0, Math.round(score)));
}

// ── TOAST HELPER (imperative) ─────────────────────────
let _toastTimer = null;
export function showToast(msg, ms = 3000) {
  const el = document.getElementById('app-toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}


// ── UPLOAD PREP ──────────────────────────────────────
// The API runs as a serverless function with a ~4.5 MB request-body cap, and base64 inflates a file
// by a third, so a normal phone photo (5-10 MB) would be rejected. Photos are downscaled in the
// browser first; other file types must fit as-is.
const MAX_UPLOAD_DATA_URL_CHARS = 4_000_000;

function readAsDataUrl(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('Could not read the file')); r.readAsDataURL(file); });
}
function loadImage(src) {
  return new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = () => rej(new Error('Could not read the image')); img.src = src; });
}

export async function prepareUploadDataUrl(file) {
  const original = await readAsDataUrl(file);
  if (original.length <= MAX_UPLOAD_DATA_URL_CHARS && !(/^image\/(jpeg|png|webp|heic|heif)/i.test(file.type) && file.size > 1_500_000)) return original;
  if (/^image\/(jpeg|png|webp|heic|heif)/i.test(file.type)) {
    try {
      const img = await loadImage(original);
      for (const [maxSide, quality] of [[2000, 0.85], [1600, 0.8], [1280, 0.7], [1024, 0.6]]) {
        const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const out = canvas.toDataURL('image/jpeg', quality);
        if (out.length <= MAX_UPLOAD_DATA_URL_CHARS) return out;
      }
    } catch { /* fall through to the size check below */ }
  }
  if (original.length > MAX_UPLOAD_DATA_URL_CHARS) throw new Error(`${file.name} is too large to upload (max about 3 MB for non-photo files)`);
  return original;
}
