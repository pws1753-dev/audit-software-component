'use strict';

// Monthly management summary: pure data builder (no database, no email). The caller supplies the
// portal data and today's date; the result is rendered by email-render.js.
//
// Dates in the portal arrive in several shapes (ISO strings, "27/5/2026", "2026-11-20"), so they are
// all reduced to an IST calendar day (UTC midnight of that day) before comparing.

const DAY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = 330 * 60 * 1000;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function dayOf(ms) { return Date.UTC(new Date(ms).getUTCFullYear(), new Date(ms).getUTCMonth(), new Date(ms).getUTCDate()); }

function parseDay(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return isNaN(value) ? null : dayOf(value.getTime() + IST_OFFSET_MS);
  if (typeof value === 'number') return Number.isFinite(value) ? dayOf(value + IST_OFFSET_MS) : null;
  const s = String(value).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s);
  if (m) return Date.UTC(+m[3] < 100 ? +m[3] + 2000 : +m[3], +m[2] - 1, +m[1]);
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : dayOf(t + IST_OFFSET_MS);
}

const deptToken = value => String(value || '').trim().replace(/\([^)]*\)/g, ' ').replace(/&/g, ' ').replace(/\band\b/ig, ' ').replace(/[^A-Za-z0-9]+/g, '').toLowerCase();

// The month being reported is the calendar month before `todayYmd`.
function monthRange(todayYmd) {
  const [y, mo] = String(todayYmd).split('-').map(Number);
  const py = mo === 1 ? y - 1 : y, pm = mo === 1 ? 12 : mo - 1;
  return {
    key: `${py}-${String(pm).padStart(2, '0')}`,
    label: `${MONTHS[pm - 1]} ${py}`,
    short: `${MONTHS[pm - 1].slice(0, 3)} ${py}`,
    start: Date.UTC(py, pm - 1, 1),
    end: Date.UTC(py, pm, 1) - 1,
  };
}
function prevMonthKey(key) {
  const [y, m] = key.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

const isLive = f => f && !f.deletedAt && String(f.status || '').toLowerCase() !== 'draft';
const isClosed = f => String(f.status || '').toLowerCase() === 'closed' || String(f.capaStatus || '').toLowerCase() === 'closed';
// Closure submitted, waiting for the auditor: still open, but the delay is no longer the department's.
const isUnderReview = f => {
  const status = String(f.status || '').toLowerCase(), capa = String(f.capaStatus || '').toLowerCase();
  return status === 'pending-closure' || (capa === 'submitted' && (!status || status === 'open'));
};
const raisedDay = f => parseDay(f.createdAt || f.submittedAt || f.auditSubmittedAt || f.date) ?? parseDay(f.due);
const closedDay = f => parseDay(f.auditClosureDate || f.closedAt || f.decisionDate || f.closureDate);

// Same scoring rules as the dashboard: adhoc audits by checkpoints, others by the frozen score.
function auditScore(a) {
  if (!a) return null;
  if ((a.adhocAudit || a.auditType === 'adhoc' || a.auditSource === 'adhoc') && a.stats) {
    const ad = Number(a.stats.adequate), na = Number(a.stats.notAdequate);
    if (Number.isFinite(ad) && Number.isFinite(na) && ad + na > 0) return Math.round(ad / (ad + na) * 100);
  }
  const frozen = Number(a.auditScoreFrozen);
  if (Number.isFinite(frozen)) return Math.max(0, Math.min(100, Math.round(frozen)));
  const c = a.auditFindingCountsFrozen;
  if (c) return Math.max(0, Math.min(100, Math.round(100 - (c.critical || 0) * 15 - (c.major || 0) * 10 - (c.minor || 0) * 5 - (c.obs || 0) * 2)));
  return null;
}
const isExternal = a => Boolean(a && (a.externalAudit || a.auditSource === 'external' || a.auditType === 'external'));

function buildMonthlySummary({ findings, audits, depts, todayYmd, prev }) {
  const range = monthRange(todayYmd);
  const today = parseDay(todayYmd);
  const live = (Array.isArray(findings) ? findings : []).filter(isLive);
  const auditList = (Array.isArray(audits) ? audits : []).filter(a => a && !a.deletedAt && (!a.status || a.status === 'submitted'));
  const deptList = Array.isArray(depts) ? depts : [];

  // One row per real department: records whose names normalise to the same token are one department,
  // and the record that owns findings (by exact code) is the one shown.
  const tokenOfCode = new Map(deptList.map(d => [String(d.code || '').toUpperCase(), deptToken(d.name) || deptToken(d.code)]));
  const keyOf = (code, name) => tokenOfCode.get(String(code || '').toUpperCase()) || deptToken(name) || deptToken(code);
  const rows = new Map();
  const rowFor = (key, code, name) => {
    if (!rows.has(key)) rows.set(key, { key, code, name, total: 0, open: 0, review: 0, overdue: 0, maxOverdue: 0, raised: 0, closedInMonth: 0, closedAll: 0 });
    return rows.get(key);
  };
  const nameOfCode = new Map(deptList.map(d => [String(d.code || '').toUpperCase(), d.name]));
  const owners = new Map();  // key -> code that owns findings, so the display name matches the real record
  live.forEach(f => { const k = keyOf(f.dept, f.deptName); if (!owners.has(k)) owners.set(k, String(f.dept || '')); });

  const overdueList = [];
  live.forEach(f => {
    const key = keyOf(f.dept, f.deptName);
    const code = owners.get(key) || String(f.dept || '');
    const r = rowFor(key, code, nameOfCode.get(code.toUpperCase()) || f.deptName || code);
    r.total++;
    const raised = raisedDay(f);
    if (raised !== null && raised >= range.start && raised <= range.end) r.raised++;
    if (isClosed(f)) {
      r.closedAll++;
      const cd = closedDay(f);
      if (cd !== null && cd >= range.start && cd <= range.end) r.closedInMonth++;
      return;
    }
    r.open++;
    if (isUnderReview(f)) { r.review++; return; }
    const due = parseDay(f.due);
    if (due !== null && today !== null && due < today) {
      const days = Math.round((today - due) / DAY_MS);
      r.overdue++;
      r.maxOverdue = Math.max(r.maxOverdue, days);
      overdueList.push({ ref: f.ref, dept: r.name, sev: f.sev || f.severity, due: f.due, days, desc: f.desc });
    }
  });

  // latest audit score per department (internal and external averaged, as on the dashboard)
  const byKey = new Map();
  auditList.forEach(a => {
    const k = keyOf(a.dept, a.deptName);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(a);
  });
  const stamp = a => Date.parse(a.submittedAt || a.date || 0) || 0;
  rows.forEach(r => {
    const list = (byKey.get(r.key) || []).slice().sort((a, b) => stamp(a) - stamp(b));
    const internal = list.filter(a => !isExternal(a)).pop(), external = list.filter(isExternal).pop();
    const scores = [internal, external].map(auditScore).filter(Number.isFinite);
    r.auditScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
    r.closurePct = r.total ? Math.round((r.closedAll / r.total) * 100) : 0;
  });

  const list = [...rows.values()].sort((a, b) => b.overdue - a.overdue || b.open - a.open || a.name.localeCompare(b.name));
  const sum = k => list.reduce((s, r) => s + r[k], 0);
  const totals = {
    total: sum('total'), open: sum('open'), underReview: sum('review'), overdue: sum('overdue'), raised: sum('raised'), closedInMonth: sum('closedInMonth'), closedAll: sum('closedAll'),
    closurePct: sum('total') ? Math.round(sum('closedAll') / sum('total') * 100) : 0,
    auditsInMonth: auditList.filter(a => { const d = parseDay(a.submittedAt || a.date); return d !== null && d >= range.start && d <= range.end; }).length,
    departmentsOverdue: list.filter(r => r.overdue > 0).length,
  };
  overdueList.sort((a, b) => b.days - a.days || String(a.ref).localeCompare(String(b.ref)));
  return { range, todayYmd, totals, departments: list, topOverdue: overdueList.slice(0, 10), prev: prev || null, prevKey: prevMonthKey(range.key) };
}

module.exports = { buildMonthlySummary, monthRange, prevMonthKey, parseDay, deptToken };
