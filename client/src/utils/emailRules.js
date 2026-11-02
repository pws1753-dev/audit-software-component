// Config for the automatic reminder engine, edited in the Email Center and stored under the
// `ap_email_rules` sync key. Mirrors EMAIL_RULES_DEFAULTS in server/lib/email-engine.js —
// the server is the authority at send time, so keep the two in step.

export const EMAIL_RULES_DEFAULTS = {
  enabled: true,
  firstReminderDays: 1,
  repeatDays: 7,
  hodAfterDays: 7,
  managementAfterDays: 15,
  ccManager: true,
  ccHod: true,
  ccGlobal: true,
  types: { upcoming_reminder: true, delayed: true, escalation: true },
  suppressed: [],
  depts: {},
};

// The three switchable reminder kinds. All of them arrive in the department's one conversation.
export const EMAIL_TYPES = [
  { key: 'upcoming_reminder', label: 'First reminder', desc: 'One day before the target date (not yet late)', to: 'SPOC' },
  { key: 'delayed', label: 'Overdue reminder', desc: 'Weekly while the NC is late, until it is 7 days overdue', to: 'SPOC' },
  { key: 'escalation', label: 'Escalation', desc: 'Weekly: 7+ days overdue goes to the HOD; 15+ days to Management', to: 'HOD' },
];

export function mergeEmailRules(stored) {
  const s = stored && typeof stored === 'object' ? stored : {};
  return {
    ...EMAIL_RULES_DEFAULTS,
    ...s,
    types: { ...EMAIL_RULES_DEFAULTS.types, ...(s.types || {}) },
    suppressed: Array.isArray(s.suppressed) ? s.suppressed : [],
    depts: s.depts && typeof s.depts === 'object' ? s.depts : {},
  };
}

export function deptRuleOf(rules, code) {
  return (rules.depts && rules.depts[code]) || {};
}

// A department is silent for a type if the type is off globally, the dept is off, or the
// dept has that specific type off.
export function isDeptTypeEnabled(rules, code, typeKey) {
  if (rules.types[typeKey] === false) return false;
  const dr = deptRuleOf(rules, code);
  if (dr.enabled === false) return false;
  return !(dr.types && dr.types[typeKey] === false);
}

export function isValidEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim());
}
