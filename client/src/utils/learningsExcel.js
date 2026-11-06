import { SEV_LABEL } from './helpers';
import { deptRecordForValue } from './dashboardHelpers';

// Excel template, export and import for the Learnings repository.
//
// A learning is stored with these fields: title, dept (code or ''), sev, clause, rc, pa, repeat,
// crossDept. `clause` is the stored name of what the screen now calls "Problem Description"; the name
// is kept so existing learnings need no migration.

const COLUMNS = ['Title', 'Department', 'Severity', 'Problem Description', 'Root Cause', 'Preventive Action', 'Repeat Issue', 'Cross-dept'];

// Column names accepted on import (old exports used "Clause" for the problem text).
const ALIASES = {
  title: ['title', 'learning title', 'learning'],
  dept: ['department', 'dept', 'department name', 'department code'],
  sev: ['severity', 'sev'],
  clause: ['problem description', 'problem', 'description', 'clause', 'clause no', 'clause no.'],
  rc: ['root cause', 'rc', 'cause'],
  pa: ['preventive action', 'pa', 'prevention', 'corrective action'],
  repeat: ['repeat issue', 'repeat', 'repeat?'],
  crossDept: ['cross-dept', 'cross dept', 'crossdept', 'cross department', 'x-dept'],
};

const norm = s => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const cell = (row, names) => {
  const keys = Object.keys(row);
  for (const n of names) {
    const k = keys.find(key => norm(key) === norm(n));
    if (k !== undefined && String(row[k]).trim() !== '') return String(row[k]).trim();
  }
  return '';
};

const SEVERITIES = { critical: 'critical', major: 'major', minor: 'minor', observation: 'obs', obs: 'obs', 'obs.': 'obs' };
function parseSeverity(v) {
  const t = norm(v);
  if (!t) return 'major';
  if (SEVERITIES[t]) return SEVERITIES[t];
  const k = Object.keys(SEVERITIES).find(key => t.startsWith(key));
  return k ? SEVERITIES[k] : null;
}
const yes = v => /^(y|yes|true|1|x|✓)$/i.test(String(v || '').trim());

export function learningToRow(l, depts) {
  const rec = l.dept ? deptRecordForValue(depts, l.dept) : null;
  return {
    Title: l.title || '',
    Department: l.dept ? (rec ? rec.name : l.dept) : 'All',
    Severity: SEV_LABEL[l.sev] || l.sev || '',
    'Problem Description': l.clause || '',
    'Root Cause': l.rc || '',
    'Preventive Action': l.pa || '',
    'Repeat Issue': l.repeat ? 'Yes' : 'No',
    'Cross-dept': l.crossDept ? 'Yes' : 'No',
  };
}

function sheetWithWidths(XLSX, rows, widths) {
  const ws = XLSX.utils.json_to_sheet(rows, { header: COLUMNS });
  ws['!cols'] = widths.map(w => ({ wch: w }));
  return ws;
}
const WIDTHS = [34, 22, 12, 52, 44, 44, 13, 12];

// The complete library, in the same layout as the template (so it can be edited and re-imported).
export function exportLearningsWorkbook(learnings, depts) {
  if (!window.XLSX) throw new Error('Excel library is still loading, please try again');
  const XLSX = window.XLSX;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheetWithWidths(XLSX, (learnings || []).map(l => learningToRow(l, depts)), WIDTHS), 'Learnings');
  XLSX.writeFile(wb, `OnePWS_Master_Learnings_${new Date().toISOString().slice(0, 10)}.xlsx`);
  return (learnings || []).length;
}

export function downloadLearningsTemplate(depts) {
  if (!window.XLSX) throw new Error('Excel library is still loading, please try again');
  const XLSX = window.XLSX;
  const wb = XLSX.utils.book_new();
  const sample = [{
    Title: 'SAMPLE ROW: delete this row before importing',
    Department: (depts && depts[0] && depts[0].name) || 'Stores',
    Severity: 'Major',
    'Problem Description': 'Calibration records were not available at the workstation during the audit.',
    'Root Cause': 'No owner was assigned to file the certificates after each calibration.',
    'Preventive Action': 'Calibration certificates are filed at the workstation within 2 days; checked in the monthly 5S audit.',
    'Repeat Issue': 'No',
    'Cross-dept': 'Yes',
  }];
  XLSX.utils.book_append_sheet(wb, sheetWithWidths(XLSX, sample, WIDTHS), 'Learnings');
  const help = [
    ['Learnings bulk import: instructions'],
    [''],
    ['1', 'Fill one learning per row on the "Learnings" sheet. Delete the sample row.'],
    ['2', 'Title is required. Everything else is optional.'],
    ['3', 'Department: the department name or code from the "Departments" sheet, or "All" (or blank) for every department.'],
    ['4', 'Severity: Critical, Major, Minor or Observation (blank means Major).'],
    ['5', 'Problem Description: what went wrong. (Older files that call this column "Clause" are also accepted.)'],
    ['6', 'Repeat Issue and Cross-dept: Yes or No (blank means No).'],
    ['7', 'Rows whose Title and Problem Description already exist for the same department are skipped as duplicates.'],
    ['8', 'You get a review screen before anything is saved.'],
  ];
  const hs = XLSX.utils.aoa_to_sheet(help); hs['!cols'] = [{ wch: 5 }, { wch: 110 }];
  XLSX.utils.book_append_sheet(wb, hs, 'Instructions');
  const ds = XLSX.utils.aoa_to_sheet([['Code', 'Department name'], ['All', 'All departments'], ...((depts || []).map(d => [d.code, d.name]))]);
  ds['!cols'] = [{ wch: 10 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, ds, 'Departments');
  XLSX.writeFile(wb, 'OnePWS_Learnings_Import_Template.xlsx');
}

// Reads an uploaded workbook. Returns the rows to import, the duplicates and the rows with problems.
export function parseLearningsWorkbook(fileData, { depts = [], existing = [] }) {
  if (!window.XLSX) throw new Error('Excel library is still loading, please try again');
  const wb = window.XLSX.read(fileData, { type: 'array' });
  const name = wb.SheetNames.find(n => norm(n) === 'learnings') || wb.SheetNames[0];
  if (!name) throw new Error('The file has no sheets');
  const raw = window.XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '', raw: false });
  if (!raw.length) throw new Error('The sheet has no data rows');

  const keyOf = (l) => [norm(l.title), norm(l.clause), String(l.dept || '').toUpperCase()].join('|');
  const seen = new Set((existing || []).map(l => keyOf({ ...l, dept: (l.dept && (deptRecordForValue(depts, l.dept) || {}).code) || l.dept || '' })));
  const valid = [], duplicates = [], invalid = [];
  raw.forEach((row, i) => {
    if (!Object.values(row).some(v => String(v == null ? '' : v).trim())) return;
    const rowNo = i + 2;
    const title = cell(row, ALIASES.title);
    if (/^sample row/i.test(title)) return;
    const problems = [];
    if (!title) problems.push('Title is missing');
    const rawDept = cell(row, ALIASES.dept);
    let deptCode = '';
    if (rawDept && !/^all( departments?)?$/i.test(rawDept)) {
      const rec = deptRecordForValue(depts, rawDept);
      if (rec) deptCode = rec.code; else problems.push(`Unknown department "${rawDept}"`);
    }
    const sev = parseSeverity(cell(row, ALIASES.sev));
    if (sev === null) problems.push(`Unknown severity "${cell(row, ALIASES.sev)}"`);
    const item = {
      title, dept: deptCode, sev: sev || 'major', clause: cell(row, ALIASES.clause), rc: cell(row, ALIASES.rc), pa: cell(row, ALIASES.pa),
      repeat: yes(cell(row, ALIASES.repeat)), crossDept: yes(cell(row, ALIASES.crossDept)),
    };
    if (problems.length) { invalid.push({ rowNo, title, problems }); return; }
    const k = keyOf(item);
    if (seen.has(k)) { duplicates.push({ rowNo, title }); return; }
    seen.add(k);
    valid.push({ rowNo, ...item });
  });
  return { valid, duplicates, invalid, total: valid.length + duplicates.length + invalid.length };
}
