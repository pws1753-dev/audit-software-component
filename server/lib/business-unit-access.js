'use strict';

const unitKey = value => String(value || '').trim().toLowerCase();
const deptKey = value => unitKey(value).replace(/\([^)]*\)/g, '').replace(/&|\band\b/g, '').replace(/[^a-z0-9]/g, '');
const isBusinessUnitHead = user => !!user && user.role === 'manager' && user.accessScope === 'businessUnit';

function businessUnitAccess(user, departments) {
  const scoped = isBusinessUnitHead(user);
  const units = new Set((Array.isArray(user?.businessUnits) ? user.businessUnits : []).map(unitKey).filter(Boolean));
  const depts = Array.isArray(departments) ? departments : [];
  const allowedDept = d => units.has(unitKey(d.businessUnit));
  const resolve = value => {
    const raw = unitKey(value);
    if (!raw) return [];
    const exact = depts.filter(d => [d.code, d.id].some(v => v && unitKey(v) === raw));
    return exact.length ? exact : depts.filter(d => [d.name, `${d.name || ''} ${d.code || ''}`].some(v => deptKey(v) === deptKey(value)));
  };
  const allows = row => {
    if (!scoped) return true;
    if (!row || typeof row !== 'object') return false;
    // A known code takes precedence over a potentially stale display name.
    for (const value of [row.dept, row.deptCode, row.department, row.deptName]) {
      const matches = resolve(value);
      if (matches.length) return matches.every(allowedDept);
    }
    return false;
  };
  const filter = (key, value) => {
    if (!scoped) return value;
    if (key === 'ap_depts') return depts.filter(allowedDept);
    if (key === 'ap_users') return Array.isArray(value) ? value.filter(u => String(u.id || u.loginId) === String(user.id || user.loginId)) : [];
    if (['ap_permissions', 'ap_capa_due', 'ap_system_settings', 'ap_root_causes'].includes(key)) return value;
    if (['ap_finds', 'ap_completed_audits', 'ap_planned_audits', 'ap_learns', 'ap_media_library', 'ap_email_master'].includes(key)) return Array.isArray(value) ? value.filter(allows) : [];
    if (key === 'ap_cps') return Array.isArray(value) ? value.filter(row => !row.dept || allows(row)) : [];
    // Unscoped notifications, imports, drafts, logs and backups can contain other units' findings.
    return Array.isArray(value) ? [] : null;
  };
  const assertWrite = (key, incoming, existing) => {
    if (!scoped) return;
    const fail = () => { const err = new Error('You can only update records in your assigned Business Units'); err.statusCode = 403; throw err; };
    if (!['ap_finds', 'ap_learns'].includes(key) || !Array.isArray(incoming)) return fail();
    const records = Array.isArray(existing) ? existing : [];
    for (const row of incoming) {
      if (!row || !(row.id || row.ref) || !allows(row)) return fail();
      const matches = records.filter(f => (row.id && f.id === row.id) || (row.ref && f.ref === row.ref));
      if (matches.some(f => !allows(f))) return fail();
      // A partial scoped sync must never replace a different finding's identity.
      if (matches.some(f => (f.id && row.id !== f.id) || (f.ref && row.ref !== f.ref))) return fail();
      if (key === 'ap_finds' && matches.some(f => ['auditId', 'auditRef'].some(field => row[field] !== f[field]))) return fail();
    }
  };
  return { scoped, allows, filter, assertWrite };
}

module.exports = { businessUnitAccess, isBusinessUnitHead };
