'use strict';

// Branded HTML emails for AuditPro: one shared shell (header, accent bar, footer), a professional
// default body for each email type, a styled NC table and a plain-text alternative.
//
// Template authors (Email Center > Email Templates) only edit the *body*; the shell is applied by the
// server so every automatic, test and reminder email looks identical.

const PORTAL_URL = String(process.env.PORTAL_URL || 'https://audit.onepws.com').replace(/\/+$/, '');
const BRAND = '#c0392b';
const FONT = "'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Variables whose value is already safe HTML. Everything else is escaped when substituted.
const RAW_VARS = new Set(['nc_table', 'button', 'summary', 'history']);

function fillTemplate(str, vars) {
  return String(str || '').replace(/\{\{(\w+)\}\}/g, (_, k) => {
    if (vars[k] === undefined || vars[k] === null) return '';
    return RAW_VARS.has(k) ? String(vars[k]) : escapeHtml(vars[k]);
  });
}
// Subjects are plain text, never HTML.
function fillSubject(str, vars) {
  return String(str || '').replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] === undefined || vars[k] === null || RAW_VARS.has(k) ? '' : String(vars[k]))).replace(/\s+/g, ' ').trim();
}

// ── per-type look ─────────────────────────────────────
const TYPE_STYLE = {
  audit_submission: { badge: 'AUDIT REPORT', accent: '#16a34a', title: 'Audit Report Submitted' },
  upcoming_reminder: { badge: 'REMINDER', accent: '#2563eb', title: 'Target Date Approaching' },
  delayed: { badge: 'OVERDUE', accent: '#d97706', title: 'Overdue NC Notification' },
  escalation: { badge: 'ESCALATION', accent: BRAND, title: 'Escalation: Overdue NC Closure' },
  capa_reminder: { badge: 'REMINDER', accent: '#d97706', title: 'CAPA Reminder' },
  test: { badge: 'TEST EMAIL', accent: '#7c3aed', title: 'Template Test' },
};

// ── NC table ──────────────────────────────────────────
const SEV = {
  critical: { label: 'Critical', bg: '#dc2626' },
  major: { label: 'Major', bg: '#d97706' },
  minor: { label: 'Minor', bg: '#0d9488' },
  obs: { label: 'Observation', bg: '#7c3aed' },
};
const STATUS_LABEL = { open: 'Open', 'in-progress': 'In Progress', delayed: 'Delayed', 'pending-closure': 'Under Review', closed: 'Closed' };
const MAX_TABLE_ROWS = 60;

function sevKey(sev) {
  const t = String(sev || 'obs').toLowerCase();
  return t.includes('critical') ? 'critical' : t.includes('major') ? 'major' : t.includes('minor') ? 'minor' : 'obs';
}
function shortText(s, n) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t;
}
function fmtDue(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  if (!m) return String(value || '-');
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m[2]) - 1];
  return `${m[3]} ${mon} ${m[1]}`;
}

// rows: [{ f: finding, hit: { overdue, daysToDue, reminder } }]; `workflowStatus` maps a finding to its status key.
// mode 'reminder' (default) shows the reminder number and the days delayed; mode 'audit' shows the status instead.
function delayCell(hit) {
  if (hit && hit.overdue > 0) return `<span style="color:#b91c1c;font-weight:700;">${hit.overdue} day${hit.overdue === 1 ? '' : 's'} delayed</span>`;
  if (hit && hit.daysToDue === 0) return '<span style="color:#b45309;font-weight:700;">Due today</span>';
  if (hit && hit.daysToDue > 0) return `<span style="color:#1d4ed8;font-weight:600;">Due in ${hit.daysToDue} day${hit.daysToDue === 1 ? '' : 's'}</span>`;
  return '<span style="color:#9ca3af;">-</span>';
}
function buildNcTable(rows, workflowStatus = f => String((f && f.status) || 'open'), opts = {}) {
  const mode = opts.mode === 'audit' ? 'audit' : 'reminder';
  const max = opts.maxRows || MAX_TABLE_ROWS;
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return '';
  const shown = list.slice(0, max);
  const th = (t, align = 'left') => `<th align="${align}" style="padding:9px 10px;background:#f3f4f6;border-bottom:2px solid #d1d5db;font:600 11px ${FONT};color:#4b5563;text-transform:uppercase;letter-spacing:.4px;">${t}</th>`;
  const head = mode === 'audit'
    ? [th('NC No. / Observation'), th('Clause'), th('Severity'), th('Target Date'), th('Status')]
    : [th('NC No. / Observation'), th('Clause'), th('Severity'), th('Target Date'), th('Reminder'), th('Days Delayed')];
  const body = shown.map(({ f, hit }, i) => {
    const sev = SEV[sevKey(f.sev || f.severity)];
    const td = `padding:10px;border-bottom:1px solid #e5e7eb;font:13px ${FONT};color:#1f2937;vertical-align:top;`;
    const last = mode === 'audit'
      ? `<td style="${td}">${STATUS_LABEL[workflowStatus(f)] || escapeHtml(workflowStatus(f))}</td>`
      : `<td style="${td}white-space:nowrap;"><span style="display:inline-block;padding:1px 8px;border-radius:10px;background:#eef2ff;color:#3730a3;font:700 12px ${FONT};">#${hit && hit.reminder ? hit.reminder : 1}</span></td><td style="${td}white-space:nowrap;">${delayCell(hit)}</td>`;
    return `<tr style="background:${i % 2 ? '#fafafa' : '#ffffff'};">
<td style="${td}"><div style="font-weight:700;color:#111827;">${escapeHtml(f.ref || '')}</div>${f.desc ? `<div style="font:12px/1.45 ${FONT};color:#6b7280;margin-top:3px;">${escapeHtml(shortText(f.desc, 150))}</div>` : ''}</td>
<td style="${td}">${escapeHtml(shortText(f.clause || '-', 28))}</td>
<td style="${td}"><span style="display:inline-block;padding:2px 8px;border-radius:10px;background:${sev.bg};color:#fff;font:600 11px ${FONT};">${sev.label}</span></td>
<td style="${td}white-space:nowrap;">${escapeHtml(fmtDue(f.due))}</td>
${last}</tr>`;
  }).join('');
  const cols = head.length;
  const more = list.length > shown.length
    ? `<tr><td colspan="${cols}" style="padding:10px;font:italic 12px ${FONT};color:#6b7280;">+ ${list.length - shown.length} more NC(s). Open the portal to see the complete list.</td></tr>`
    : '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:6px;border-collapse:separate;border-spacing:0;margin:14px 0 6px;">
<thead><tr>${head.join('')}</tr></thead>
<tbody>${body}${more}</tbody></table>`;
}

// Earlier messages of this conversation, so every email carries the full trail on its own.
function historyLabel(h) {
  if (h.kind === 'audit_report') return 'Audit report';
  if (h.kind === 'manual') return `Manual reminder #${h.reminderNo || ''}`.trim();
  const to = h.level >= 3 ? ' (Management)' : h.level === 2 ? ' (HOD)' : '';
  return `Reminder #${h.reminderNo || ''}${to}`.trim();
}
function buildHistory(entries, limit = 8) {
  const list = (Array.isArray(entries) ? entries : []).slice(-limit);
  if (!list.length) return '';
  const th = t => `<th align="left" style="padding:7px 10px;background:#f3f4f6;border-bottom:1px solid #d1d5db;font:600 10.5px ${FONT};color:#6b7280;text-transform:uppercase;letter-spacing:.4px;">${t}</th>`;
  const td = `padding:7px 10px;border-bottom:1px solid #eef0f3;font:12px ${FONT};color:#374151;`;
  const date = iso => { const d = new Date(iso); return isNaN(d) ? '-' : d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }); };
  const rows = list.map(h => `<tr><td style="${td}">${h.n || ''}</td><td style="${td}white-space:nowrap;">${date(h.at)}</td><td style="${td}">${escapeHtml(historyLabel(h))}</td><td style="${td}">${h.ncCount != null ? h.ncCount : '-'}</td><td style="${td}">${h.maxDelay > 0 ? h.maxDelay + ' days' : '-'}</td></tr>`).join('');
  return `<div style="margin:22px 0 4px;font:700 12px ${FONT};color:#374151;text-transform:uppercase;letter-spacing:.5px;">Earlier in this conversation</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:6px;border-collapse:separate;border-spacing:0;margin:8px 0;"><thead><tr>${th('#')}${th('Date')}${th('Message')}${th('NCs')}${th('Max delay')}</tr></thead><tbody>${rows}</tbody></table>`;
}

// Small "facts" box: [[label, value], ...]
function buildSummary(pairs, accent = BRAND) {
  const cells = pairs.map(([k, v]) => `<td style="padding:10px 14px;border-right:1px solid #e5e7eb;vertical-align:top;"><div style="font:600 10.5px ${FONT};color:#6b7280;text-transform:uppercase;letter-spacing:.4px;">${escapeHtml(k)}</div><div style="font:700 15px ${FONT};color:#111827;margin-top:3px;">${escapeHtml(v)}</div></td>`).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-left:4px solid ${accent};border-radius:6px;background:#f9fafb;margin:14px 0;"><tr>${cells}</tr></table>`;
}

function buildButton(label, url, accent = BRAND) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0 6px;"><tr><td style="border-radius:6px;background:${accent};"><a href="${escapeHtml(url)}" target="_blank" style="display:inline-block;padding:11px 22px;font:600 14px ${FONT};color:#ffffff;text-decoration:none;border-radius:6px;">${escapeHtml(label)}</a></td></tr></table>`;
}

// ── shell ─────────────────────────────────────────────
function shell({ type, title, content, preheader, escalationLevel }) {
  const st = TYPE_STYLE[type] || TYPE_STYLE.test;
  const heading = title || (type === 'escalation' && escalationLevel ? `Escalation (Level ${escalationLevel}): Overdue NC Closure` : st.title);
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${escapeHtml(heading)}</title></head>
<body style="margin:0;padding:0;background:#f3f4f7;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader || heading)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f7;"><tr><td align="center" style="padding:24px 10px;">
<table role="presentation" width="680" cellpadding="0" cellspacing="0" style="width:100%;max-width:680px;background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
<tr><td style="padding:18px 28px;border-bottom:1px solid #eef0f3;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td align="left" style="vertical-align:middle;"><img src="${PORTAL_URL}/assets/onepws-dark-logo-scaled.png" alt="OnePWS" width="119" height="34" style="display:block;width:119px;height:34px;border:0;font:700 20px ${FONT};color:${BRAND};"></td>
<td align="right" style="vertical-align:middle;font:600 11px ${FONT};color:#6b7280;letter-spacing:.3px;">AuditPro &nbsp;|&nbsp; Quality Management Portal</td>
</tr></table></td></tr>
<tr><td style="height:5px;line-height:5px;font-size:0;background:${st.accent};">&nbsp;</td></tr>
<tr><td style="padding:26px 28px 4px;">
<span style="display:inline-block;padding:3px 10px;border-radius:12px;background:${st.accent};color:#fff;font:700 10.5px ${FONT};letter-spacing:.8px;">${st.badge}</span>
<h1 style="margin:10px 0 0;font:700 21px/1.3 ${FONT};color:#111827;">${escapeHtml(heading)}</h1></td></tr>
<tr><td style="padding:12px 28px 26px;font:14px/1.65 ${FONT};color:#374151;">${content}</td></tr>
<tr><td style="padding:16px 28px;background:#f9fafb;border-top:1px solid #eef0f3;font:12px/1.6 ${FONT};color:#6b7280;">
This is an automated message from the <strong style="color:#374151;">OnePWS AuditPro</strong> portal. Please log in to the portal to submit closure evidence or to update the status of an NC; replies to this address are not monitored. For help, contact the Quality / Process team.</td></tr>
</table>
<div style="font:11px ${FONT};color:#9ca3af;padding:14px 8px 0;">&copy; OnePWS Pvt. Ltd. &nbsp;|&nbsp; Confidential: intended only for the named recipients.</div>
</td></tr></table></body></html>`;
}

// ── plain-text alternative ────────────────────────────
function htmlToText(html) {
  return String(html || '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, label) => `${label.replace(/<[^>]+>/g, '').trim()} (${href.replace(/&amp;/g, '&')})`)
    .replace(/<\/(td|th)>\s*<(td|th)/gi, '</$1> | <$2')
    .replace(/<\/(p|div|tr|h1|h2|h3|table|li)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&copy;/g, '(c)')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
}

// ── default templates (professional wording) ──────────
// Body only. Variables: department_name, spoc_name, audit_name, nc_count, submitted_at, nc_table,
// nc_number, target_date, delay_days, clause_name, clause_description, window_days,
// escalation_level, escalation_label, recipient_name (who the email is addressed to), portal_url, summary, button.
const P = `margin:0 0 12px;`;
const DEFAULT_TEMPLATES = [
  {
    id: 'tpl_audit_submission', type: 'audit_submission', name: 'Audit Report Submission', active: true,
    subject: 'Audit Report Submitted - {{department_name}}',
    body: `<p style="${P}">Dear {{spoc_name}},</p>
<p style="${P}">The audit of <strong>{{department_name}}</strong> has been completed and its report is now available in AuditPro.</p>
{{summary}}
<p style="${P}">The non-conformances (NCs) raised are listed below. Please review each one and submit the corrective action, with closure evidence, in the CAPA Tracker before its target date. You will receive a reminder one day before each target date and then once a week until the NC is closed; all of them arrive in this same conversation.</p>
{{nc_table}}
{{button}}
{{history}}
<p style="margin:18px 0 0;">Regards,<br><strong>Audit Team</strong><br>OnePWS Pvt. Ltd.</p>`,
  },
  {
    id: 'tpl_upcoming_reminder', type: 'upcoming_reminder', name: 'Upcoming Target Closure Reminder', active: true,
    subject: 'Reminder: {{nc_count}} NC(s) due soon - {{department_name}}',
    body: `<p style="${P}">Dear {{recipient_name}},</p>
<p style="${P}">This is <strong>reminder #{{reminder_count}}</strong> for the open NC(s) of <strong>{{department_name}}</strong> that reach their target closure date {{due_phrase}}.</p>
{{summary}}
{{nc_table}}
<p style="${P}">Please complete the corrective action and submit the closure evidence in the CAPA Tracker on or before the target date, so that the NC does not become overdue. If an NC stays open, a further reminder follows in this conversation after {{repeat_days}} days.</p>
{{button}}
{{history}}
<p style="margin:18px 0 0;">Regards,<br><strong>Audit Team</strong><br>OnePWS Pvt. Ltd.</p>`,
  },
  {
    id: 'tpl_delayed', type: 'delayed', name: 'Delayed NC Notification', active: true,
    subject: 'Action required: {{nc_count}} overdue NC(s) - {{department_name}}',
    body: `<p style="${P}">Dear {{recipient_name}},</p>
<p style="${P}">This is <strong>reminder #{{reminder_count}}</strong>. The following NC(s) of <strong>{{department_name}}</strong> have <strong>crossed their target closure date</strong> and are still open; the longest has been delayed by <strong>{{max_days_delayed}} day(s)</strong>.</p>
{{summary}}
{{nc_table}}
<p style="${P}">Please submit the corrective action and closure evidence in the CAPA Tracker immediately. NCs that stay overdue are escalated to the Head of Department and then to Management, in this same conversation.</p>
{{button}}
{{history}}
<p style="margin:18px 0 0;">Regards,<br><strong>Audit Team</strong><br>OnePWS Pvt. Ltd.</p>`,
  },
  {
    id: 'tpl_escalation', type: 'escalation', name: 'Escalation Reminder', active: true,
    subject: 'Escalation (Level {{escalation_level}}): {{nc_count}} overdue NC(s) - {{department_name}}',
    body: `<p style="${P}">Dear {{recipient_name}},</p>
<p style="${P}">This is <strong>reminder #{{reminder_count}}</strong>. {{nc_count}} NC(s) of <strong>{{department_name}}</strong> remain overdue (the longest by <strong>{{max_days_delayed}} day(s)</strong>) and have been escalated to <strong>Level {{escalation_level}}</strong> ({{escalation_label}}).</p>
{{summary}}
{{nc_table}}
<p style="${P}">Immediate attention is needed. Please make sure the corrective action is completed and the closure evidence is submitted in the CAPA Tracker without further delay.</p>
{{button}}
{{history}}
<p style="margin:18px 0 0;">Regards,<br><strong>Audit Team</strong><br>OnePWS Pvt. Ltd.</p>`,
  },
];
const DEFAULT_BY_TYPE = Object.fromEntries(DEFAULT_TEMPLATES.map(t => [t.type, t]));

// The plain wording that was seeded originally. A stored template that still has exactly this text
// was never edited, so it is upgraded to the professional default instead of being kept.
const LEGACY_BODIES = {
  audit_submission: 'Dear {{spoc_name}},<br><br>The audit report for {{department_name}} has been submitted.<br><br><table border="1" cellpadding="6" cellspacing="0"><tr><th>Audit</th><th>Findings</th><th>Submitted</th></tr><tr><td>{{audit_name}}</td><td>{{nc_count}}</td><td>{{submitted_at}}</td></tr></table><br>Regards,<br>Audit Team<br><br>{{nc_table}}',
  upcoming_reminder: 'Dear {{spoc_name}},<br><br>The following NCs are due within {{window_days}} day(s).<br><br>{{nc_table}}<br>Please close the pending NCs at the earliest.<br><br>Regards,<br>Audit Team',
  delayed: 'Dear {{spoc_name}},<br><br>The following NCs have crossed the target closure date.<br><br>{{nc_table}}<br>Please submit closure evidence immediately.<br><br>Regards,<br>Audit Team',
  escalation: 'Dear {{spoc_name}},<br><br>The following NCs remain delayed and have reached escalation level {{escalation_level}}.<br><br>{{nc_table}}<br>Regards,<br>Audit Team',
};

// Wording shipped earlier in this project. Same rule: unedited text is replaced by the current default.
const PREVIOUS_BODIES = {'audit_submission': '<p style="margin:0 0 12px;">Dear {{spoc_name}},</p>\n<p style="margin:0 0 12px;">The audit of <strong>{{department_name}}</strong> has been completed and its report is now available in AuditPro.</p>\n{{summary}}\n<p style="margin:0 0 12px;">The non-conformances (NCs) raised are listed below. Please review each one and submit the corrective action, with closure evidence, in the CAPA Tracker before its target date.</p>\n{{nc_table}}\n{{button}}\n<p style="margin:18px 0 0;">Regards,<br><strong>Audit Team</strong><br>OnePWS Pvt. Ltd.</p>', 'upcoming_reminder': '<p style="margin:0 0 12px;">Dear {{spoc_name}},</p>\n<p style="margin:0 0 12px;">This is a reminder that the following NC(s) of <strong>{{department_name}}</strong> reach their target closure date within the next {{window_days}} day(s).</p>\n{{nc_table}}\n<p style="margin:0 0 12px;">Please complete the corrective action and submit the closure evidence in the CAPA Tracker on or before the target date, so that the NC does not become overdue.</p>\n{{button}}\n<p style="margin:18px 0 0;">Regards,<br><strong>Audit Team</strong><br>OnePWS Pvt. Ltd.</p>', 'delayed': '<p style="margin:0 0 12px;">Dear {{spoc_name}},</p>\n<p style="margin:0 0 12px;">The following NC(s) of <strong>{{department_name}}</strong> have <strong>crossed their target closure date</strong> and are still open.</p>\n{{nc_table}}\n<p style="margin:0 0 12px;">Please submit the corrective action and closure evidence in the CAPA Tracker immediately. NCs that stay overdue are escalated to the Head of Department and then to Management.</p>\n{{button}}\n<p style="margin:18px 0 0;">Regards,<br><strong>Audit Team</strong><br>OnePWS Pvt. Ltd.</p>', 'escalation': '<p style="margin:0 0 12px;">Dear {{recipient_name}},</p>\n<p style="margin:0 0 12px;">{{nc_count}} NC(s) of <strong>{{department_name}}</strong> remain overdue and have been escalated to <strong>Level {{escalation_level}}</strong> ({{escalation_label}}).</p>\n{{nc_table}}\n<p style="margin:0 0 12px;">Immediate attention is needed. Please make sure the corrective action is completed and the closure evidence is submitted in the CAPA Tracker without further delay.</p>\n{{button}}\n<p style="margin:18px 0 0;">Regards,<br><strong>Audit Team</strong><br>OnePWS Pvt. Ltd.</p>'};
const norm = s => String(s || '').replace(/\s+/g, ' ').trim();
function isLegacyTemplate(row, type) {
  const body = norm(row.body);
  return Boolean(LEGACY_BODIES[type]) && (body === norm(LEGACY_BODIES[type]) || body === norm(PREVIOUS_BODIES[type]));
}

// Stored template for a type (admin-edited text wins), else the built-in default.
// Returns null when the admin switched the template off.
function pickTemplate(templates, type) {
  const row = (Array.isArray(templates) ? templates : []).find(t => t && (String(t.type || '').trim() === type || String(t.id || '').trim().replace(/^tpl_/, '') === type));
  const fallback = DEFAULT_BY_TYPE[type];
  if (!row) return fallback ? { ...fallback } : null;
  if (row.active === false) return null;
  if (fallback && (isLegacyTemplate(row, type) || !norm(row.body))) return { ...fallback, id: row.id || fallback.id, name: row.name || fallback.name };
  return row;
}

// ── render ────────────────────────────────────────────
// tpl: { subject, body }; type: key into TYPE_STYLE; vars: template values.
// opts.subject : replaces the template subject (threaded emails must keep one fixed subject)
function renderEmail(tpl, type, vars = {}, opts = {}) {
  const st = TYPE_STYLE[type] || TYPE_STYLE.test;
  const all = { portal_url: PORTAL_URL, ...vars };
  if (!all.recipient_name) all.recipient_name = all.spoc_name || 'Team';
  if (!all.button) all.button = buildButton(type === 'audit_submission' ? 'View Findings in AuditPro' : 'Open CAPA Tracker in AuditPro', PORTAL_URL, st.accent);
  const subject = opts.subject || fillSubject(tpl.subject, all);
  let bodyTpl = String(tpl.body || '');
  // A template edited before reminders were threaded has no {{summary}} / {{history}} slot. Add them so
  // the reminder count, the days delayed and the earlier messages are never missing from an email.
  if (all.summary && !/\{\{summary\}\}/.test(bodyTpl)) bodyTpl = /\{\{nc_table\}\}/.test(bodyTpl) ? bodyTpl.replace('{{nc_table}}', '{{summary}}{{nc_table}}') : bodyTpl + '{{summary}}';
  if (all.history && !/\{\{history\}\}/.test(bodyTpl)) bodyTpl += '{{history}}';
  const content = fillTemplate(bodyTpl, all);
  const html = shell({ type, content, preheader: subject, escalationLevel: all.escalation_level });
  return { subject, html, text: htmlToText(content) + `\n\n--\nOnePWS AuditPro: ${PORTAL_URL}\nThis is an automated message; replies are not monitored.` };
}

// Sample values so an admin can preview / test-send a template without real NCs.
function sampleVars(type) {
  const today = new Date();
  const ymd = d => new Date(today.getTime() + d * 86400000).toISOString().slice(0, 10);
  const rows = [
    { f: { ref: 'SAMPLE-2026-001', desc: 'Calibration records for the torque wrenches are not available at the workstation.', clause: 'AS9100D 7.1.5', sev: 'major', due: ymd(-9), status: 'delayed' }, hit: { overdue: 9, daysToDue: -9, reminder: 2 } },
    { f: { ref: 'SAMPLE-2026-002', desc: 'Obsolete drawing revision found on the shop floor console.', clause: 'AS9100D 7.5.3', sev: 'minor', due: ymd(-2), status: 'open' }, hit: { overdue: 2, daysToDue: -2, reminder: 2 } },
    { f: { ref: 'SAMPLE-2026-003', desc: 'Training matrix has not been updated for new operators.', clause: 'AS9100D 7.2', sev: 'obs', due: ymd(5), status: 'in-progress' }, hit: { overdue: 0, daysToDue: 1, reminder: 1 } },
  ];
  return {
    department_name: 'Sample Department', spoc_name: 'Sample SPOC', recipient_name: type === 'escalation' ? 'Head of Department, Sample Department' : 'Sample SPOC',
    audit_name: 'Sample Internal Audit', nc_count: rows.length, submitted_at: today.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
    nc_table: buildNcTable(rows), nc_number: rows[0].f.ref, target_date: rows[0].f.due, delay_days: 9, clause_name: rows[0].f.clause,
    clause_description: rows[0].f.desc, window_days: 1, escalation_level: '2', escalation_label: 'Head of Department review',
    reminder_count: 2, max_days_delayed: 9, due_phrase: 'tomorrow', repeat_days: 7,
    history: buildHistory([{ n: 1, at: new Date(today.getTime() - 7 * 86400000).toISOString(), kind: 'reminder', reminderNo: 1, level: 1, ncCount: 3, maxDelay: 2 }]),
    summary: buildSummary([['Audit', 'Sample Internal Audit'], ['Findings (NCs)', String(rows.length)], ['Submitted on', today.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })]], '#16a34a'),
  };
}

module.exports = {
  PORTAL_URL, escapeHtml, fillTemplate, buildNcTable, buildSummary, buildButton, htmlToText,
  sampleVars, buildHistory, DEFAULT_TEMPLATES, DEFAULT_BY_TYPE, TYPE_STYLE, isLegacyTemplate, pickTemplate, renderEmail,
};
