const clean = value => String(value || '').trim();
const key = value => clean(value).toLowerCase();
const validEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(value));
const splitEmails = value => clean(value).split(/\|\||[;,]/).map(clean).filter(validEmail);
const unique = values => [...new Map(values.filter(Boolean).map(value => [key(value), clean(value)])).values()];

function departmentForUser(user, departments) {
  const wanted = key(user?.dept);
  if (!wanted) return null;
  return (departments || []).find(dept => [dept.code, dept.id, dept.name].some(value => key(value) === wanted)) || null;
}

// Email routing already falls back to active department users on the server. Mirror
// that behavior in the UI so a newly created SPOC/manager is visible immediately,
// even before somebody creates a separate Email Master row for the department.
export function emailMasterWithUsers(emailMaster, users, departments) {
  const rows = (Array.isArray(emailMaster) ? emailMaster : []).map(row => ({ ...row }));
  const byDept = new Map();
  (Array.isArray(users) ? users : []).forEach(user => {
    if (!user || user.active === false || !validEmail(user.email)) return;
    const dept = departmentForUser(user, departments);
    if (!dept) return;
    const deptKey = key(dept.code);
    if (!byDept.has(deptKey)) byDept.set(deptKey, { dept, spocs: [], managers: [] });
    const target = user.role === 'spoc' ? 'spocs' : user.role === 'manager' ? 'managers' : null;
    if (target) byDept.get(deptKey)[target].push(user);
  });

  byDept.forEach(({ dept, spocs, managers }, deptKey) => {
    const matching = rows.filter(row => key(row.deptCode) === deptKey || key(row.department) === key(dept.name));
    if (!matching.length && spocs.length) {
      rows.push({
        id: `user_email_${dept.code}`, deptCode: dept.code, department: dept.name,
        spocName: unique(spocs.map(user => user.name)).join(', '),
        email: unique(spocs.map(user => user.email)).join(', '),
        reportingName: unique(managers.map(user => user.name)).join(', '),
        reportingEmail: unique(managers.map(user => user.email)).join(', '),
        status: 'active', derivedFromUsers: true,
      });
      return;
    }
    matching.forEach(row => {
      row.email = unique([...splitEmails(row.email), ...spocs.map(user => user.email)]).join(', ');
      row.spocName = unique([row.spocName, ...spocs.map(user => user.name)]).join(', ');
      row.reportingEmail = unique([...splitEmails(row.reportingEmail), ...managers.map(user => user.email)]).join(', ');
      row.reportingName = unique([row.reportingName, ...managers.map(user => user.name)]).join(', ');
    });
  });
  return rows;
}
