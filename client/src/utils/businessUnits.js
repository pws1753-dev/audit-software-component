export const DEFAULT_BUSINESS_UNITS = ['CD', 'CR', 'PWSFloors', 'MOT'];

export function businessUnitOptions(departments, users = []) {
  const units = [...DEFAULT_BUSINESS_UNITS, ...departments.map(d => d.businessUnit), ...users.flatMap(u => Array.isArray(u.businessUnits) ? u.businessUnits : [])];
  return [...new Map(units.filter(Boolean).map(v => [v.trim().toLowerCase(), v.trim()])).values()];
}
