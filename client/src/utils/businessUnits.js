export const COMMON_BUSINESS_UNIT = 'Common';
export const DEFAULT_BUSINESS_UNITS = ['CD', 'CR', 'PWSFloors', 'MOT', COMMON_BUSINESS_UNIT];

export function businessUnitOptions(departments, users = []) {
  const units = [...DEFAULT_BUSINESS_UNITS, ...(departments || []).map(d => d.businessUnit), ...(users || []).flatMap(u => Array.isArray(u.businessUnits) ? u.businessUnits : [])];
  return [...new Map(units.filter(Boolean).map(v => [String(v).trim().toLowerCase(), String(v).trim()])).values()];
}

export function departmentsInBusinessUnit(departments, businessUnit) {
  const selected = String(businessUnit || '').trim().toLowerCase();
  if (!selected) return departments || [];
  return (departments || []).filter(dept => String(dept.businessUnit || '').trim().toLowerCase() === selected);
}

export function assignedBusinessUnits(user) {
  if (!user || user.role === 'admin' || user.accessScope !== 'businessUnit') return [];
  const units = new Map();
  (Array.isArray(user.businessUnits) ? user.businessUnits : []).forEach(value => {
    const clean = String(value || '').trim();
    if (clean && !units.has(clean.toLowerCase())) units.set(clean.toLowerCase(), clean);
  });
  return [...units.values()];
}

export function isBusinessUnitScoped(user) {
  return !!user && user.role !== 'admin' && user.accessScope === 'businessUnit';
}
