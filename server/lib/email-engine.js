'use strict';

// Automatic CAPA reminder engine.
//
// Runs on the server (see the cron wiring in server.js) rather than in an admin's browser, so a
// reminder goes out whether or not anyone has the portal open. Every automatic email CCs the
// department's Manager and HOD/BUH from the Email Master, plus the global CC list.
//
// Escalation policy mirrors the matrix the CAPA page already advertises to users:
//   due/overdue 0-6d Delayed NC -> SPOC              on delay days 0, 3 and 6
//   overdue 7d+    Escalation   -> HOD (SPOC in CC)  every 2 days, until the NC is closed
//   overdue 15d+   Escalation   -> Management        every 30 days (in addition to the HOD mails)
//   due within 0-2d Upcoming    -> SPOC              once per target date
//
// Besides sending and logging, each run flips overdue NCs to 'delayed' (see below).

const { getCollection } = require('./mongo');
const { getMailer, SMTP_FROM } = require('./mailer');
const { mergeEmailLogs } = require('./sync-helpers');
const { claimEmailLock, commitEmailLock, emailSendLockKey } = require('./email-locks');
const { buildNcTable: renderNcTable, buildSummary, pickTemplate, renderEmail } = require('./email-render');

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TZ = process.env.EMAIL_CRON_TZ || 'Asia/Kolkata';
const DEFAULT_WINDOW_DAYS = Number(process.env.EMAIL_REMINDER_WINDOW_DAYS || 2);

// Defaults for ap_email_rules — the config the Email Center writes. Mirrored in
// client/src/utils/emailRules.js; keep the two in step.
const EMAIL_RULES_DEFAULTS = {
  enabled: true,
  windowDays: DEFAULT_WINDOW_DAYS,
  ccManager: true,
  ccHod: true,
  ccGlobal: true,
  types: { upcoming_reminder: true, delayed: true, escalation: true },
  frequencies: { upcoming_reminder: 365, delayed: 1, escalation_2: 2, escalation_3: 30 },
  suppressed: [],
  depts: {},
};

const READ_KEYS = ['ap_finds', 'ap_depts', 'ap_users', 'ap_auds', 'ap_completed_audits', 'ap_email_master', 'ap_email_templates', 'ap_required_cc_emails', 'ap_system_settings', 'ap_email_rules'];

function mergeRules(stored) {
  const s = stored && typeof stored === 'object' ? stored : {};
  return {
    ...EMAIL_RULES_DEFAULTS,
    ...s,
    types: { ...EMAIL_RULES_DEFAULTS.types, ...(s.types || {}) },
    frequencies: { ...EMAIL_RULES_DEFAULTS.frequencies, ...(s.frequencies || {}) },
    suppressed: Array.isArray(s.suppressed) ? s.suppressed : [],
    depts: s.depts && typeof s.depts === 'object' ? s.depts : {},
  };
}

// Both escalation levels are governed by the single "escalation" switch in the UI.
function typeSwitchKey(bucket) {
  return bucket.startsWith('escalation') ? 'escalation' : bucket;
}

// ── DATES ────────────────────────────────────────────
// Findings store `due` as a plain YYYY-MM-DD with no timezone. The server may well run in UTC
// while the business day is IST, so anchor "today" to an explicit zone: comparing against a UTC
// clock would flip a due date a day early or late for anyone near midnight.
function todayYmd(tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function ymdToMs(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || '').trim());
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
}

// ── FINDINGS ─────────────────────────────────────────
// Mirrors findingWorkflowStatus() in client/src/utils/helpers.js — keep the two in step.
function workflowStatus(f) {
  if (!f) return '';
  const status = String(f.status || '').toLowerCase();
  const capa = String(f.capaStatus || '').toLowerCase();
  if (status === 'closed' || capa === 'closed') return 'closed';
  if (status === 'pending-closure') return 'pending-closure';
  if (capa === 'submitted' && (!status || status === 'open')) return 'pending-closure';
  return status || capa || 'open';
}

function isActionable(f) {
  if (!f || f.deletedAt) return false;
  if (String(f.status || '').toLowerCase() === 'draft') return false;
  const ws = workflowStatus(f);
  // 'pending-closure' sits with the reviewer, not the SPOC — nagging the SPOC there is noise.
  return ws !== 'closed' && ws !== 'pending-closure';
}

function classifyAll(f, todayMs, windowDays) {
  const dueMs = ymdToMs(f.due);
  if (!Number.isFinite(dueMs)) return [];
  const overdue = Math.round((todayMs - dueMs) / DAY_MS);
  // An NC keeps nagging the department's HOD (level 2) for as long as it stays overdue; past 15
  // days management is additionally told (level 3). Previously level 3 *replaced* level 2, so a
  // department whose NCs were all 15+ days late went silent for a whole month between mails.
  if (overdue >= 15) return [{ type: 'escalation', level: 3, overdue }, { type: 'escalation', level: 2, overdue }];
  if (overdue >= 7) return [{ type: 'escalation', level: 2, overdue }];
  const hits = [];
  if ([0, 3, 6].includes(overdue)) hits.push({ type: 'delayed', level: 1, overdue });
  const until = -overdue;
  if (until >= 0 && until <= Math.min(2, windowDays)) hits.push({ type: 'upcoming_reminder', level: 0, overdue: 0, until });
  return hits;
}

function classify(f, todayMs, windowDays) {
  return classifyAll(f, todayMs, windowDays)[0] || null;
}

function bucketOf(hit) {
  return hit.type === 'escalation' ? `escalation_${hit.level}` : hit.type;
}

// ── RECIPIENTS ───────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function splitEmails(value) {
  return String(value || '')
    .split(/\|\||[;,]/)
    .map(s => s.trim())
    .filter(s => EMAIL_RE.test(s));
}
function dedupe(list) {
  const seen = new Set();
  return list.filter(e => {
    const k = e.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
function withoutAll(list, exclude) {
  const block = new Set(exclude.map(e => e.toLowerCase()));
  return list.filter(e => !block.has(e.toLowerCase()));
}

function deptToken(value) {
  return String(value || '').trim().replace(/\([^)]*\)/g, ' ').replace(/&/g, ' ').replace(/\band\b/ig, ' ').replace(/[^A-Za-z0-9]+/g, '').toLowerCase();
}
function deptMatches(depts, a, b) {
  const find = value => {
    const raw = String(value || '').trim();
    const token = deptToken(raw);
    return (depts || []).find(d => String(d.code || d.id || '').toUpperCase() === raw.toUpperCase() || deptToken(d.name) === token || deptToken(d.code) === token);
  };
  const da = find(a), db = find(b);
  if (da && db) return String(da.code) === String(db.code) || deptToken(da.name) === deptToken(db.name);
  return Boolean(deptToken(a) && deptToken(a) === deptToken(b));
}

// By default the department Manager and HOD/BUH ride along on every automatic email. The Email
// Center can turn each of those off globally, add per-department CCs, or override the To line.
function recipientsFor(bucket, master, globalCc, rules = EMAIL_RULES_DEFAULTS, deptRule = {}, requiredCc = []) {
  const spoc = splitEmails(master && master.email);
  const manager = splitEmails(master && master.reportingEmail);
  const hod = splitEmails(master && master.hodEmail);
  const management = splitEmails(master && master.managementEmail);
  const overrideTo = splitEmails((Array.isArray(deptRule.overrideTo) ? deptRule.overrideTo : []).join(','));

  let to;
  if (overrideTo.length) to = overrideTo;
  else if (bucket === 'escalation_3') to = dedupe([...management]);
  else if (bucket === 'escalation_2') to = dedupe([...hod]);
  else to = dedupe([...spoc]);

  // Never drop an email on the floor because one field is blank: fall back to the *next* level
  // that has an address. (Taking all levels at once would put management on every HOD reminder.)
  if (!to.length) {
    const chain = bucket === 'escalation_3' ? [management, hod, manager, spoc]
      : bucket === 'escalation_2' ? [hod, manager, spoc, management]
        : [spoc, manager, hod, management];
    to = dedupe(chain.find(level => level.length) || []);
  }
  if (!to.length) return { to: [], cc: [] };

  const cc = dedupe([
    ...(rules.ccManager !== false ? manager : []),
    ...(rules.ccHod !== false ? hod : []),
    ...(bucket.startsWith('escalation') ? spoc : []),
    ...splitEmails((Array.isArray(deptRule.extraCc) ? deptRule.extraCc : []).join(',')),
    ...requiredCc,
    ...(rules.ccGlobal !== false ? globalCc : []),
  ]);
  return { to, cc: withoutAll(cc, to) };
}

// ── TEMPLATES ────────────────────────────────────────
// Both escalation levels share the one "escalation" template; level is exposed as {{escalation_level}}.
// Rendering (branded shell, styled NC table, plain-text part, default wording) lives in email-render.js.
function templateFor(templates, bucket) {
  return pickTemplate(templates, bucket.startsWith('escalation') ? 'escalation' : bucket);
}
const buildNcTable = rows => renderNcTable(rows, workflowStatus);
const typeOfBucket = bucket => (bucket.startsWith('escalation') ? 'escalation' : bucket);

// ── STORE ────────────────────────────────────────────
async function readKeys(collection) {
  const docs = await collection.find({ key: { $in: READ_KEYS } }).toArray();
  const out = {};
  docs.forEach(d => { out[d.key] = d.value; });
  return out;
}

async function appendEmailLogs(collection, logs, by) {
  if (!logs.length) return;
  const current = await collection.findOne({ key: 'ap_email_logs' });
  const value = mergeEmailLogs(current && current.value, logs, current && current.clearedAt);
  await collection.updateOne(
    { key: 'ap_email_logs' },
    { $set: { key: 'ap_email_logs', value, updatedAt: new Date(), updatedBy: by, clearedAt: (current && current.clearedAt) || null } },
    { upsert: true }
  );
}

// ── ENGINE ───────────────────────────────────────────
async function runEmailAutomation(options = {}) {
  const by = String(options.by || 'cron');
  const dryRun = Boolean(options.dryRun);
  const tz = options.tz || DEFAULT_TZ;

  const collection = await getCollection();
  const data = await readKeys(collection);

  const settings = data.ap_system_settings && typeof data.ap_system_settings === 'object' ? data.ap_system_settings : {};
  const rules = mergeRules(data.ap_email_rules);

  // Two independent kill switches: the long-standing system setting, and the Email Center's own.
  if (settings.emailNotifications === false) {
    return { ok: true, skipped: 'emailNotifications is off in System Settings', sent: 0, failed: 0, skippedCount: 0, groups: 0, results: [] };
  }
  if (rules.enabled === false) {
    return { ok: true, skipped: 'Automatic emails are paused in the Email Center', sent: 0, failed: 0, skippedCount: 0, groups: 0, results: [] };
  }

  let findings = Array.isArray(data.ap_finds) ? data.ap_finds : [];
  const emailMaster = Array.isArray(data.ap_email_master) ? data.ap_email_master : [];
  const templates = Array.isArray(data.ap_email_templates) ? data.ap_email_templates : [];
  const depts = Array.isArray(data.ap_depts) ? data.ap_depts : [];
  const users = Array.isArray(data.ap_users) ? data.ap_users.filter(user => user && user.active !== false && user.email) : [];
  const auditors = Array.isArray(data.ap_auds) ? data.ap_auds : [];
  const completedAudits = (Array.isArray(data.ap_completed_audits) ? data.ap_completed_audits : []).filter(audit => audit && !audit.deletedAt);
  const globalCc = dedupe(splitEmails((Array.isArray(data.ap_required_cc_emails) ? data.ap_required_cc_emails : []).join(',')));
  const windowDays = Math.max(0, Number(rules.windowDays != null ? rules.windowDays : settings.reminderWindowDays || DEFAULT_WINDOW_DAYS));
  const autoEscalation = settings.autoEscalation !== false;
  const suppressed = new Set(splitEmails((rules.suppressed || []).join(',')).map(e => e.toLowerCase()));
  const stripSuppressed = list => list.filter(e => !suppressed.has(e.toLowerCase()));

  const todayMs = ymdToMs(todayYmd(tz));

  // Keep workflow status aligned with the source portal: the due date itself remains
  // actionable without being marked delayed; status flips only after the date is missed.
  if (!dryRun) {
    const nowIso = new Date().toISOString();
    let changed = false;
    const nextFindings = findings.map(f => {
      const dueMs = ymdToMs(f && f.due);
      if (!isActionable(f) || !Number.isFinite(dueMs) || dueMs >= todayMs || String(f.status || '').toLowerCase() === 'delayed') return f;
      changed = true;
      const activityLog = Array.isArray(f.activityLog) ? f.activityLog.slice() : [];
      if (!activityLog.some(log => /auto status changed to delayed/i.test(String(log && log.action)))) {
        activityLog.push({ user: 'System', action: 'Auto status changed to Delayed (due date missed)', ts: new Date().toLocaleString('en-IN', { timeZone: tz }) });
      }
      return { ...f, previousStatusBeforeDelay: f.status || 'open', status: 'delayed', capaStatus: 'delayed', delayedAt: f.delayedAt || nowIso, updatedAt: nowIso, activityLog };
    });
    if (changed) {
      const update = await collection.updateOne(
        { key: 'ap_finds', value: findings },
        { $set: { value: nextFindings, updatedAt: new Date(), updatedBy: `email-engine:${by}` } }
      );
      if (update.modifiedCount) findings = nextFindings;
    }
  }

  // Group actionable findings by department + bucket: one email per dept per bucket, not per NC.
  const groups = new Map();
  const muted = [];
  findings.filter(isActionable).forEach(f => {
    classifyAll(f, todayMs, windowDays).forEach(hit => {
    const bucket = bucketOf(hit);
    if (!autoEscalation && bucket.startsWith('escalation')) return;
    const findingDept = f.dept || f.deptName || '';
    const deptRecord = depts.find(d => deptMatches(depts, d.code, findingDept) || deptMatches(depts, d.name, findingDept));
    const deptCode = String((deptRecord && deptRecord.code) || findingDept).trim();
    if (!deptCode) return;

    // "kisko send karna hai, kisko nahi" — the Email Center's per-type and per-department switches.
    const deptRule = rules.depts[deptCode] || {};
    const typeKey = typeSwitchKey(bucket);
    if (rules.types[typeKey] === false) { muted.push({ bucket, deptCode, reason: `${typeKey} emails are switched off for everyone` }); return; }
    if (deptRule.enabled === false) { muted.push({ bucket, deptCode, reason: `${deptCode} is switched off in the Email Center` }); return; }
    if (deptRule.types && deptRule.types[typeKey] === false) { muted.push({ bucket, deptCode, reason: `${typeKey} is switched off for ${deptCode}` }); return; }

    const gk = `${bucket}|${deptCode}`;
    if (!groups.has(gk)) groups.set(gk, { bucket, deptCode, rows: [] });
    groups.get(gk).rows.push({ f, hit });
    });
  });

  const results = [];
  const logs = [];
  let sent = 0, failed = 0, skipped = 0;

  const processGroup = async (group) => {
    const { bucket, deptCode, rows } = group;
    // One department's failure (lock store hiccup, bad data) must not abort the departments after it.
    try {
    const matchingMasterRecords = emailMaster.filter(m => deptMatches(depts, m.deptCode, deptCode) || deptMatches(depts, m.department, deptCode));
    const master = matchingMasterRecords.find(m => String(m.status || 'active').toLowerCase() !== 'inactive') || null;
    const masterRecord = master || matchingMasterRecords[0] || null;
    const dept = depts.find(d => deptMatches(depts, d.code, deptCode));
    const deptName = (masterRecord && masterRecord.department) || (dept && dept.name) || deptCode;
    let sendRows = rows;
    let refs = sendRows.map(r => r.f.ref).filter(Boolean).sort();

    if (matchingMasterRecords.length && !master) {
      skipped++;
      results.push({ bucket, dept: deptCode, deptName, ncCount: rows.length, status: 'skipped', reason: `email record for ${deptCode} is deactivated` });
      return;
    }

    const tpl = templateFor(templates, bucket);
    if (!tpl) {
      skipped++;
      results.push({ bucket, dept: deptCode, ncCount: rows.length, status: 'skipped', reason: `no active template for "${bucket}"` });
      return;
    }

    const deptRule = rules.depts[deptCode] || {};
    const deptUsers = users.filter(user => deptMatches(depts, user.dept, deptCode));
    const deptAudits = completedAudits.filter(audit => deptMatches(depts, audit.dept || audit.deptName || audit.department, deptCode));
    const latestAudit = deptAudits.slice().sort((a, b) => Date.parse(a.submittedAt || a.date || 0) - Date.parse(b.submittedAt || b.date || 0)).pop() || {};
    const auditorEmails = dedupe([
      ...auditors.filter(auditor => auditor && auditor.email && latestAudit.auditor && auditor.name === latestAudit.auditor).flatMap(auditor => splitEmails(auditor.email)),
      ...users.filter(user => user.role === 'auditor' && (!latestAudit.auditor || user.name === latestAudit.auditor || user.loginId === latestAudit.auditor)).flatMap(user => splitEmails(user.email)),
    ]);
    const requiredCc = dedupe([...auditorEmails, ...users.filter(user => user.role === 'admin').flatMap(user => splitEmails(user.email))]);
    const resolvedMaster = {
      ...(master || {}),
      email: dedupe([...splitEmails(master && master.email), ...deptUsers.filter(user => user.role === 'spoc').flatMap(user => splitEmails(user.email))]).join(', '),
      reportingEmail: dedupe([...splitEmails(master && master.reportingEmail), ...deptUsers.filter(user => user.role === 'manager').flatMap(user => splitEmails(user.email))]).join(', '),
      managementEmail: dedupe([...splitEmails(master && master.managementEmail), ...users.filter(user => user.role === 'admin' || user.role === 'viewer').flatMap(user => splitEmails(user.email))]).join(', '),
    };
    const resolved = recipientsFor(bucket, resolvedMaster, globalCc, rules, deptRule, requiredCc);
    const to = stripSuppressed(resolved.to);
    // Findings imported from an external audit carry their own responsible owner; keep that
    // person in the loop (CC) alongside the department chain.
    const ownerCc = dedupe(rows.flatMap(r => splitEmails(r.f.ownerEmail)));
    const cc = stripSuppressed(withoutAll(dedupe([...resolved.cc, ...ownerCc]), resolved.to));
    if (!to.length) {
      // Surface the gap instead of dropping silently — a missing SPOC address in the Email
      // Master is exactly how a department stops receiving reminders without anyone noticing.
      skipped++;
      const reason = !master
        ? `dept ${deptCode} is not in the Email Master`
        : resolved.to.length
          ? `every recipient for dept ${deptCode} is on the suppression list`
          : `no usable email addresses for dept ${deptCode}`;
      results.push({ bucket, dept: deptCode, deptName, ncCount: rows.length, status: 'skipped', reason });
      logs.push({ id: `${bucket}_${deptCode}_${Date.now()}`, type: bucket, to: '', cc: '', subject: `[not sent] ${deptName} — ${rows.length} NC(s)`, status: 'skipped', error: reason, dept: deptCode, ncCount: rows.length, sentAt: new Date().toISOString() });
      return;
    }

    const frequencyDays = bucket === 'upcoming_reminder' ? 365 : (Number(rules.frequencies[bucket]) || 1);
    const lockRows = [];
    if (!dryRun) {
      // Claims are independent per finding, so run them together: a department with 20 NCs
      // would otherwise cost 20 sequential round trips, and the Vercel function has a 60s budget.
      const claims = await Promise.all(rows.map(async row => {
        const findingKey = String(row.f.id || row.f.ref || '').trim();
        const dueKey = bucket === 'upcoming_reminder' ? `:${row.f.due || ''}` : '';
        const lockKey = `auto:${bucket}:${deptCode}:${findingKey}${dueKey}`;
        const granted = await claimEmailLock(collection, lockKey, frequencyDays, { bucket, deptCode, refs: [row.f.ref].filter(Boolean) }, by);
        return granted ? { row, lockKey } : null;
      }));
      claims.forEach(item => { if (item) lockRows.push(item); });
      if (!lockRows.length) {
        skipped++;
        results.push({ bucket, dept: deptCode, deptName, ncCount: rows.length, status: 'throttled', reason: `all findings were already sent within the last ${frequencyDays} day(s)` });
        return;
      }
      sendRows = lockRows.map(item => item.row);
      refs = sendRows.map(r => r.f.ref).filter(Boolean).sort();
    }

    const worst = sendRows.reduce((a, b) => (b.hit.overdue > a.hit.overdue ? b : a), sendRows[0]);
    const vars = {
      department_name: deptName,
      spoc_name: (master && master.spocName) || deptName,
      nc_count: sendRows.length,
      nc_table: buildNcTable(sendRows),
      nc_number: worst.f.ref || '',
      target_date: worst.f.due || '',
      delay_days: worst.hit.overdue || 0,
      clause_name: worst.f.clause || '',
      clause_description: worst.f.desc || '',
      window_days: windowDays,
      escalation_level: bucket.startsWith('escalation') ? String(bucket.split('_')[1]) : '',
      audit_name: worst.f.auditRef || '',
    };
    // Level 2 goes to the HOD and level 3 to Management, so they must not be greeted as the SPOC.
    vars.recipient_name = bucket === 'escalation_3' ? 'Management Team' : bucket === 'escalation_2' ? `Head of Department, ${deptName}` : vars.spoc_name;
    vars.escalation_label = bucket === 'escalation_3' ? 'Management review' : bucket === 'escalation_2' ? 'Head of Department review' : '';
    const { subject, html, text } = renderEmail(tpl, typeOfBucket(bucket), vars);
    if (dryRun) {
      results.push({ bucket, dept: deptCode, deptName, ncCount: sendRows.length, status: 'dry-run', to, cc, subject, html, refs, frequencyDays });
      return;
    }

    try {
      const transport = getMailer();
      await transport.sendMail({ from: SMTP_FROM, to, cc, subject, html, text });
      await Promise.all(lockRows.map(item => commitEmailLock(collection, item.lockKey, frequencyDays, true, by)));
      sent++;
      results.push({ bucket, dept: deptCode, deptName, ncCount: sendRows.length, status: 'sent', to, cc, subject });
      logs.push({ id: `${bucket}_${deptCode}_${Date.now()}`, type: bucket, to: to.join(', '), cc: cc.join(', '), subject, status: 'sent', dept: deptCode, ncCount: sendRows.length, sentAt: new Date().toISOString() });
    } catch (err) {
      await Promise.all(lockRows.map(item => commitEmailLock(collection, item.lockKey, frequencyDays, false, by)));
      failed++;
      results.push({ bucket, dept: deptCode, deptName, ncCount: sendRows.length, status: 'failed', to, cc, error: err.message });
      logs.push({ id: `${bucket}_${deptCode}_${Date.now()}`, type: bucket, to: to.join(', '), cc: cc.join(', '), subject, status: 'failed', error: err.message, dept: deptCode, ncCount: sendRows.length, sentAt: new Date().toISOString() });
    }
    } catch (err) {
      failed++;
      console.error(`[AuditPro] Email automation: ${bucket} for ${deptCode} aborted:`, err);
      results.push({ bucket, dept: deptCode, ncCount: rows.length, status: 'failed', error: err.message });
      logs.push({ id: `${bucket}_${deptCode}_${Date.now()}`, type: bucket, to: '', cc: '', subject: `[not sent] ${deptCode} — ${rows.length} NC(s)`, status: 'failed', error: err.message, dept: deptCode, ncCount: rows.length, sentAt: new Date().toISOString() });
    }
  };
  // A few departments at a time: sequential SMTP + lock round trips for 20+ groups can outlast the
  // serverless time limit, and one slow mail should not hold up the rest.
  const queue = Array.from(groups.values());
  await Promise.all(Array.from({ length: Math.min(3, queue.length) }, async () => {
    while (queue.length) await processGroup(queue.shift());
  }));

  if (!dryRun) await appendEmailLogs(collection, logs, `email-engine:${by}`);

  // `muted` is the deliberately-silenced set. It is reported rather than hidden so an admin can
  // see at a glance that a department is quiet because they switched it off, not because it broke.
  const mutedGroups = Array.from(new Map(muted.map(m => [`${m.bucket}|${m.deptCode}`, m])).values());
  const summary = {
    ok: true, ranAt: new Date().toISOString(), tz, today: todayYmd(tz), dryRun,
    groups: results.length, sent, failed, skipped, muted: mutedGroups, results,
  };
  if (!dryRun) {
    console.log(`[AuditPro] Email automation: ${sent} sent, ${failed} failed, ${skipped} skipped, ${mutedGroups.length} muted`);
    // Safety net: any recent audit whose report mail was missed (old browser tab, SMTP hiccup) goes out now.
    try {
      const reports = await sendDueAuditSubmissionEmails({ by });
      summary.auditReports = { sent: reports.sent, failed: reports.failed, skipped: reports.skipped };
      if (reports.sent || reports.failed) console.log(`[AuditPro] Audit report emails: ${reports.sent} sent, ${reports.failed} failed`);
    } catch (err) { console.error('[AuditPro] Audit report catch-up failed:', err); }
  }
  return summary;
}



// Who an email for one department goes to: SPOC / Manager / HOD / Management from the Email Master
// plus the department's portal users, mandatory CC (auditor + admins), global CC and the per-department
// overrides, minus the Never-Email list. Shared by the one-off emails below.
function resolveDeptRecipients(ctx, deptCode, bucket, { auditorName = '', rows = [] } = {}) {
  const { depts, emailMaster, users, auditors, globalCc, rules } = ctx;
  const suppressed = new Set(splitEmails((rules.suppressed || []).join(',')).map(e => e.toLowerCase()));
  const strip = list => list.filter(e => !suppressed.has(e.toLowerCase()));
  const matching = emailMaster.filter(m => deptMatches(depts, m.deptCode, deptCode) || deptMatches(depts, m.department, deptCode));
  const master = matching.find(m => String(m.status || 'active').toLowerCase() !== 'inactive') || null;
  const deptUsers = users.filter(u => deptMatches(depts, u.dept, deptCode));
  const auditorEmails = dedupe([
    ...auditors.filter(a => a && a.email && auditorName && a.name === auditorName).flatMap(a => splitEmails(a.email)),
    ...users.filter(u => u.role === 'auditor' && (!auditorName || u.name === auditorName || u.loginId === auditorName)).flatMap(u => splitEmails(u.email)),
  ]);
  const requiredCc = dedupe([...auditorEmails, ...users.filter(u => u.role === 'admin').flatMap(u => splitEmails(u.email))]);
  const resolvedMaster = {
    ...(master || {}),
    email: dedupe([...splitEmails(master && master.email), ...deptUsers.filter(u => u.role === 'spoc').flatMap(u => splitEmails(u.email))]).join(', '),
    reportingEmail: dedupe([...splitEmails(master && master.reportingEmail), ...deptUsers.filter(u => u.role === 'manager').flatMap(u => splitEmails(u.email))]).join(', '),
    managementEmail: dedupe([...splitEmails(master && master.managementEmail), ...users.filter(u => u.role === 'admin' || u.role === 'viewer').flatMap(u => splitEmails(u.email))]).join(', '),
  };
  const resolved = recipientsFor(bucket, resolvedMaster, globalCc, rules, rules.depts[deptCode] || {}, requiredCc);
  const to = strip(resolved.to);
  const ownerCc = dedupe(rows.flatMap(r => splitEmails(r.ownerEmail)));
  const cc = strip(withoutAll(dedupe([...resolved.cc, ...ownerCc]), resolved.to));
  return { master, matching, to, cc };
}
function emailContext(data) {
  const rules = mergeRules(data.ap_email_rules);
  return {
    rules,
    settings: data.ap_system_settings && typeof data.ap_system_settings === 'object' ? data.ap_system_settings : {},
    depts: Array.isArray(data.ap_depts) ? data.ap_depts : [],
    emailMaster: Array.isArray(data.ap_email_master) ? data.ap_email_master : [],
    templates: Array.isArray(data.ap_email_templates) ? data.ap_email_templates : [],
    users: Array.isArray(data.ap_users) ? data.ap_users.filter(u => u && u.active !== false && u.email) : [],
    auditors: Array.isArray(data.ap_auds) ? data.ap_auds : [],
    globalCc: dedupe(splitEmails((Array.isArray(data.ap_required_cc_emails) ? data.ap_required_cc_emails : []).join(','))),
  };
}

// ── AUDIT SUBMISSION EMAIL ───────────────────────────
// "Audit Report Submitted" goes to the department SPOC (Manager / HOD / auditor / admins in CC) once
// per audit, using the editable `audit_submission` template. It is idempotent: a send record per
// audit means a repeat call (or a double click) cannot email the department twice.
async function sendAuditSubmissionEmails(options = {}) {
  const by = String(options.by || 'audit-submission');
  const dryRun = Boolean(options.dryRun);
  const tz = options.tz || DEFAULT_TZ;
  const wanted = new Set((Array.isArray(options.auditIds) ? options.auditIds : []).map(String).filter(Boolean));
  const empty = { ok: true, sent: 0, failed: 0, skipped: 0, missing: [], results: [] };
  if (!wanted.size) return empty;

  const collection = await getCollection();
  const data = await readKeys(collection);
  const ctx = emailContext(data);
  const { settings, rules } = ctx;
  if (settings.emailNotifications === false) return { ...empty, skippedReason: 'emailNotifications is off in System Settings' };
  if (rules.enabled === false) return { ...empty, skippedReason: 'Automatic emails are paused in the Email Center' };

  const findings = (Array.isArray(data.ap_finds) ? data.ap_finds : []).filter(f => f && !f.deletedAt && String(f.status || '').toLowerCase() !== 'draft');
  const { depts, emailMaster, templates } = ctx;
  const audits = (Array.isArray(data.ap_completed_audits) ? data.ap_completed_audits : [])
    .filter(a => a && !a.deletedAt && (wanted.has(String(a.id)) || wanted.has(String(a.ref || a.auditRef))));

  const results = [];
  const logs = [];
  let sent = 0, failed = 0, skipped = 0;
  const note = (r, log) => { results.push(r); if (log) logs.push(log); };

  for (const audit of audits) {
    const ref = String(audit.ref || audit.auditRef || audit.id);
    try {
      const deptRecord = depts.find(d => deptMatches(depts, d.code, audit.dept) || deptMatches(depts, d.name, audit.deptName || audit.dept));
      const deptCode = String((deptRecord && deptRecord.code) || audit.dept || '').trim();
      const matching = emailMaster.filter(m => deptMatches(depts, m.deptCode, deptCode) || deptMatches(depts, m.department, deptCode));
      const master = matching.find(m => String(m.status || 'active').toLowerCase() !== 'inactive') || null;
      const deptName = (matching[0] && matching[0].department) || (deptRecord && deptRecord.name) || audit.deptName || deptCode;
      const deptRule = rules.depts[deptCode] || {};
      const base = { audit: ref, dept: deptCode, deptName };

      const refs = new Set((audit.findingRefs || []).map(String));
      const rows = findings.filter(f => String(f.auditRef || f.auditId || '') === ref || refs.has(String(f.ref || '')))
        .filter(f => deptMatches(depts, f.dept || f.deptName, deptCode));

      // The audit and its findings are saved by separate requests. If the findings have not landed yet,
      // do nothing (no send record is taken) so the next call sends the complete mail.
      if (refs.size && !rows.length) { note({ ...base, status: 'deferred', reason: 'its findings are still being saved' }); continue; }
      if (deptRule.enabled === false) { skipped++; note({ ...base, status: 'skipped', reason: `${deptCode} is switched off in the Email Center` }); continue; }
      if (matching.length && !master) { skipped++; note({ ...base, status: 'skipped', reason: `email record for ${deptCode} is deactivated` }); continue; }
      const tpl = templateFor(templates, 'audit_submission');
      if (!tpl) { skipped++; note({ ...base, status: 'skipped', reason: 'no active "audit_submission" template' }); continue; }

      const { to, cc } = resolveDeptRecipients(ctx, deptCode, 'audit_submission', { auditorName: audit.auditor, rows });
      if (!to.length) {
        skipped++;
        const reason = `no usable email address for dept ${deptCode}`;
        note({ ...base, status: 'skipped', reason }, { id: `audit_submission_${deptCode}_${Date.now()}`, type: 'audit_submission', to: '', cc: '', subject: `[not sent] Audit Report Submitted - ${deptName}`, status: 'skipped', error: reason, dept: deptCode, ncCount: rows.length, sentAt: new Date().toISOString() });
        continue;
      }

      const submitted = new Date(audit.submittedAt || audit.date || Date.now());
      const vars = {
        department_name: deptName,
        spoc_name: (master && master.spocName) || deptName,
        audit_name: audit.title || ref,
        nc_count: rows.length,
        submitted_at: new Intl.DateTimeFormat('en-IN', { timeZone: tz, day: '2-digit', month: 'short', year: 'numeric' }).format(isNaN(submitted) ? new Date() : submitted),
        nc_table: rows.length ? buildNcTable(rows.map(f => ({ f, hit: { overdue: 0 } }))) : '',
      };
      vars.summary = buildSummary([['Audit', vars.audit_name], ['Findings (NCs)', String(vars.nc_count)], ['Submitted on', vars.submitted_at]], '#16a34a');
      const { subject, html, text } = renderEmail(tpl, 'audit_submission', vars);
      if (dryRun) { note({ ...base, status: 'dry-run', ncCount: rows.length, to, cc, subject }); continue; }

      const lockKey = `audit_submission:${ref}:${deptCode}`;
      if (!(await claimEmailLock(collection, lockKey, 365, { bucket: 'audit_submission', deptCode, refs: [ref] }, by))) {
        skipped++; note({ ...base, status: 'throttled', reason: 'the audit report mail was already sent for this audit' }); continue;
      }
      try {
        await getMailer().sendMail({ from: SMTP_FROM, to, cc, subject, html, text });
        await commitEmailLock(collection, lockKey, 365, true, by);
        sent++;
        note({ ...base, status: 'sent', ncCount: rows.length, to, cc, subject }, { id: `audit_submission_${deptCode}_${Date.now()}`, type: 'audit_submission', to: to.join(', '), cc: cc.join(', '), subject, status: 'sent', dept: deptCode, ncCount: rows.length, sentAt: new Date().toISOString() });
      } catch (err) {
        await commitEmailLock(collection, lockKey, 365, false, by);
        failed++;
        note({ ...base, status: 'failed', error: err.message }, { id: `audit_submission_${deptCode}_${Date.now()}`, type: 'audit_submission', to: to.join(', '), cc: cc.join(', '), subject, status: 'failed', error: err.message, dept: deptCode, ncCount: rows.length, sentAt: new Date().toISOString() });
      }
    } catch (err) {
      failed++;
      note({ audit: ref, status: 'failed', error: err.message });
    }
  }
  const missing = [...wanted].filter(id => !audits.some(a => String(a.id) === id || String(a.ref || a.auditRef) === id));
  if (!dryRun) await appendEmailLogs(collection, logs, `email-engine:${by}`);
  return { ok: true, sent, failed, skipped, missing, results };
}



// Audits that still owe their "Audit Report Submitted" email (created recently, on-portal, no sent record).
// Safe to call as often as needed: sent audits are skipped before anything is resolved or logged.
// The portal calls it after every audit save and the daily run calls it as a safety net, so the mail
// does not depend on the user's browser running the latest version of the portal.
async function sendDueAuditSubmissionEmails(options = {}) {
  const by = String(options.by || 'audit-submission');
  const maxAgeMs = Math.max(1, Number(options.maxAgeDays || 7)) * DAY_MS;
  const waitMs = Math.max(0, Number(options.waitForFindingsMs || 0));
  const started = Date.now();
  const collection = await getCollection();
  let ready = [];
  for (;;) {
    const data = await readKeys(collection);
    const depts = Array.isArray(data.ap_depts) ? data.ap_depts : [];
    const findings = Array.isArray(data.ap_finds) ? data.ap_finds : [];
    const candidates = (Array.isArray(data.ap_completed_audits) ? data.ap_completed_audits : []).filter(a => {
      if (!a || a.deletedAt || a.derivedFromFindings || a.externalAudit || a.auditSource === 'external' || a.auditType === 'external') return false;
      if (a.status && a.status !== 'submitted') return false;
      const t = Date.parse(a.createdAt || a.updatedAt || a.submittedAt || '');
      return Number.isFinite(t) && Date.now() - t <= maxAgeMs;
    });
    if (!candidates.length) return { ok: true, sent: 0, failed: 0, skipped: 0, results: [], missing: [] };
    const locks = candidates.map(a => {
      const ref = String(a.ref || a.auditRef || a.id);
      const rec = depts.find(d => deptMatches(depts, d.code, a.dept) || deptMatches(depts, d.name, a.deptName || a.dept));
      return { a, key: emailSendLockKey(`audit_submission:${ref}:${String((rec && rec.code) || a.dept || '').trim()}`) };
    });
    const done = new Set((await collection.find({ key: { $in: locks.map(l => l.key) }, lastSentAt: { $exists: true } }).toArray()).map(d => d.key));
    const pending = locks.filter(l => !done.has(l.key)).map(l => l.a);
    if (!pending.length) return { ok: true, sent: 0, failed: 0, skipped: 0, results: [], missing: [] };
    const hasFindings = a => !(a.findingRefs || []).length || findings.some(f => f && (a.findingRefs || []).includes(f.ref));
    ready = pending.filter(hasFindings);
    if (ready.length === pending.length || Date.now() - started >= waitMs) break;
    await new Promise(r => setTimeout(r, 1500));
  }
  if (!ready.length) return { ok: true, sent: 0, failed: 0, skipped: 0, results: [], missing: [] };
  return sendAuditSubmissionEmails({ auditIds: ready.map(a => String(a.id || a.ref)), by });
}

// ── MANUAL NC REMINDER (CAPA "Remind" button) ────────
// One reminder to the department SPOC for a single NC, using the delayed (overdue) or upcoming
// template. Limited to one per NC per day so the button cannot be used to spam a department.
async function sendNcReminder(options = {}) {
  const by = String(options.by || 'manual');
  const tz = options.tz || DEFAULT_TZ;
  const key = String(options.findingId || '').trim();
  if (!key) return { ok: false, error: 'findingId is required' };

  const collection = await getCollection();
  const data = await readKeys(collection);
  const ctx = emailContext(data);
  const { settings, rules, depts, templates } = ctx;
  if (settings.emailNotifications === false) return { ok: false, error: 'Email notifications are switched off in System Settings' };

  const f = (Array.isArray(data.ap_finds) ? data.ap_finds : []).find(x => x && !x.deletedAt && (String(x.id) === key || String(x.ref) === key));
  if (!f) return { ok: false, error: 'NC not found' };
  if (!isActionable(f)) return { ok: false, error: 'This NC is closed or already submitted for review, so no reminder is needed' };

  const todayMs = ymdToMs(todayYmd(tz));
  const dueMs = ymdToMs(f.due);
  const overdue = Number.isFinite(dueMs) ? Math.round((todayMs - dueMs) / DAY_MS) : 0;
  const type = overdue >= 0 ? 'delayed' : 'upcoming_reminder';
  const tpl = templateFor(templates, type);
  if (!tpl) return { ok: false, error: `The "${type}" email template is switched off` };

  const deptRecord = depts.find(d => deptMatches(depts, d.code, f.dept || f.deptName) || deptMatches(depts, d.name, f.deptName || f.dept));
  const deptCode = String((deptRecord && deptRecord.code) || f.dept || '').trim();
  const { master, matching, to, cc } = resolveDeptRecipients(ctx, deptCode, type, { rows: [f] });
  const deptName = (matching[0] && matching[0].department) || (deptRecord && deptRecord.name) || f.deptName || deptCode;
  if (matching.length && !master) return { ok: false, error: `The email record for ${deptName} is deactivated` };
  if (!to.length) return { ok: false, error: `No email address is configured for ${deptName}` };

  const lockKey = `manual_remind:${f.id || f.ref}`;
  if (!(await claimEmailLock(collection, lockKey, 1, { bucket: 'capa_reminder', deptCode, refs: [f.ref] }, by))) {
    return { ok: false, throttled: true, error: 'A reminder for this NC was already sent in the last 24 hours' };
  }
  const row = { f, hit: { overdue: Math.max(0, overdue) } };
  const vars = {
    department_name: deptName, spoc_name: (master && master.spocName) || deptName, recipient_name: (master && master.spocName) || deptName,
    nc_count: 1, nc_table: buildNcTable([row]), nc_number: f.ref || '', target_date: f.due || '', delay_days: Math.max(0, overdue),
    clause_name: f.clause || '', clause_description: f.desc || '', window_days: Math.max(0, -overdue), audit_name: f.auditRef || '',
  };
  const mail = renderEmail(tpl, type, vars);
  const subject = `CAPA Reminder - ${f.ref} - ${deptName}`;
  try {
    await getMailer().sendMail({ from: SMTP_FROM, to, cc, subject, html: mail.html, text: mail.text });
    await commitEmailLock(collection, lockKey, 1, true, by);
    await appendEmailLogs(collection, [{ id: `capa_reminder_${f.ref}_${Date.now()}`, type: 'capa_reminder', to: to.join(', '), cc: cc.join(', '), subject, status: 'sent', dept: deptCode, ncCount: 1, sentAt: new Date().toISOString() }], `email-engine:${by}`);
    return { ok: true, to, cc, subject };
  } catch (err) {
    await commitEmailLock(collection, lockKey, 1, false, by);
    await appendEmailLogs(collection, [{ id: `capa_reminder_${f.ref}_${Date.now()}`, type: 'capa_reminder', to: to.join(', '), cc: cc.join(', '), subject, status: 'failed', error: err.message, dept: deptCode, ncCount: 1, sentAt: new Date().toISOString() }], `email-engine:${by}`);
    return { ok: false, error: `Email could not be sent: ${err.message}` };
  }
}

module.exports = { sendDueAuditSubmissionEmails, sendNcReminder, sendAuditSubmissionEmails, runEmailAutomation, workflowStatus, classify, classifyAll, recipientsFor, splitEmails, todayYmd, ymdToMs, mergeRules, EMAIL_RULES_DEFAULTS };
