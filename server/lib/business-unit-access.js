'use strict';

const unitKey = value => String(value || '').trim().toLowerCase();
const deptKey = value => unitKey(value).replace(/\([^)]*\)/g, '').replace(/&|\band\b/g, '').replace(/[^a-z0-9]/g, '');
// Explicit BU isolation is a data boundary, not a role permission. Older code
// limited it to managers, so viewer-style BU accounts silently got global data.
const isBusinessUnitHead = user => !!user && user.role !== 'admin' && user.accessScope === 'businessUnit';

function businessUnitAccess(user, departments) {
  const depts = Array.isArray(departments) ? departments : [];
  const configuredUnits = new Map();
  depts.forEach(d => {
    const clean = String(d?.businessUnit || '').trim();
    if (clean && !configuredUnits.has(unitKey(clean))) configuredUnits.set(unitKey(clean), clean);
  });
  const explicit = isBusinessUnitHead(user);
  const assignedDepartments = user?.role !== 'admin'
    ? depts.filter(d => [d.code, d.id, d.name].some(value => value && unitKey(value) === unitKey(user?.dept)))
    : [];
  // Legacy BU accounts may store a unit name in `dept`. An exact department match
  // always wins when a code and unit share a label (for example department CD and
  // Business Unit CD); otherwise a department SPOC could inherit the whole unit.
  const inferredByDept = user?.role !== 'admin' && assignedDepartments.length === 0
    ? configuredUnits.get(unitKey(user?.dept))
    : '';
  const loginCompact = deptKey(user?.loginId);
  const inferredByLogin = user?.role !== 'admin' && /buh|huh/.test(loginCompact)
    ? [...configuredUnits.entries()].find(([, label]) => {
      const unitCompact = deptKey(label);
      return [`buh${unitCompact}`, `huh${unitCompact}`, `${unitCompact}buh`, `${unitCompact}huh`].includes(loginCompact);
    })?.[1]
    : '';
  // A department assignment is not a Business Unit Head assignment. In particular,
  // treating a SPOC's department as its BU gave that SPOC every sibling department's
  // findings. Only explicit BU accounts and recognizable legacy BUH/HUH identities
  // receive unit-wide access; SPOCs are restricted to their exact department.
  const inferredUnit = inferredByDept || inferredByLogin;
  // Any assigned operational account is department-scoped unless an administrator
  // explicitly grants Business Unit access. Auditors intentionally remain global;
  // managers/viewers with a department must not silently receive company-wide data.
  // A stale/unknown department assignment fails closed (zero matching departments).
  const hasDepartmentAssignment = Boolean(String(user?.dept || '').trim());
  const departmentScoped = !explicit && !inferredUnit && user?.role !== 'admin' && user?.role !== 'auditor'
    && (assignedDepartments.length > 0 || hasDepartmentAssignment || user?.role === 'spoc');
  const scoped = explicit || !!inferredUnit || departmentScoped;
  const assignedUnits = explicit ? (Array.isArray(user?.businessUnits) ? user.businessUnits : []) : [inferredUnit];
  const units = new Set(assignedUnits.map(unitKey).filter(Boolean));
  const assignedDeptKeys = new Set(assignedDepartments.flatMap(d => [d.code, d.id, d.name]).map(unitKey).filter(Boolean));
  const allowedDept = d => departmentScoped
    ? [d.code, d.id, d.name].some(value => assignedDeptKeys.has(unitKey(value)))
    : units.has(unitKey(d.businessUnit));
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
    const fail = () => { const err = new Error('You can only update records in your assigned department scope'); err.statusCode = 403; throw err; };
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
  return {
    scoped, businessUnitScoped: scoped && !departmentScoped, departmentScoped,
    scope: departmentScoped ? 'department' : (scoped ? 'businessUnit' : ''),
    departments: departmentScoped ? assignedDepartments.map(d => d.code).filter(Boolean) : [],
    units: [...units].map(key => configuredUnits.get(key) || assignedUnits.find(value => unitKey(value) === key) || key),
    allows, filter, assertWrite,
  };
}

module.exports = { businessUnitAccess, isBusinessUnitHead };
