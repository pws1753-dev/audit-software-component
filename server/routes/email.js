'use strict';

const express = require('express');
const router = express.Router();
const { getCollection } = require('../lib/mongo');
const { getMailer, parseRecipients, SMTP_FROM } = require('../lib/mailer');
const { wrapAsync, requireAdmin, requireRoles, requirePageAccess, actorOf } = require('../middleware/auth');
const { mergeEmailLogs } = require('../lib/sync-helpers');
const { emailSendLockKey, claimEmailLock } = require('../lib/email-locks');
const { runEmailAutomation, sendAuditSubmissionEmails, sendNcReminder, sendMonthlySummary } = require('../lib/email-engine');
const { DEFAULT_TEMPLATES, TYPE_STYLE, renderEmail, sampleVars } = require('../lib/email-render');

function normalizeEmailLockItems(input) {
  return (Array.isArray(input) ? input : []).map(item => {
    const key = String((item && item.key) || '').trim();
    const frequencyDays = Math.max(1, Math.min(365, Number((item && item.frequencyDays) || 1)));
    if (!key) return null;
    return { key, frequencyDays, meta: item && typeof item.meta === 'object' ? item.meta : {} };
  }).filter(Boolean).slice(0, 100);
}

// GET /api/email/verify
router.get('/verify', wrapAsync(async (req, res) => {
  await requirePageAccess(req, 'masterdata');
  const transport = getMailer();
  const verified = await transport.verify();
  res.json({ ok: true, smtp: Boolean(verified) });
}));

// POST /api/email
// Sends arbitrary subject/HTML to arbitrary recipients using the org's SMTP identity —
// currently only used by the admin-only "Send Test" template action, so gate it the
// same way. Relax deliberately (with its own access check) if a non-admin flow needs it.
router.post('/', wrapAsync(async (req, res) => {
  requireAdmin(req);
  const to = parseRecipients(req.body && req.body.to);
  const cc = parseRecipients(req.body && req.body.cc);
  const bcc = parseRecipients(req.body && req.body.bcc);
  const subject = String((req.body && req.body.subject) || '').trim();
  const text = String((req.body && req.body.text) || '').trim();
  const html = req.body && req.body.html ? String(req.body.html) : undefined;
  const attachments = Array.isArray(req.body && req.body.attachments)
    ? req.body.attachments.filter(i => i && typeof i.url === 'string' && /^https:\/\//i.test(i.url)).map(i => ({ filename: String(i.filename || 'attachment'), path: String(i.url) }))
    : [];
  if (!to.length) return res.status(400).json({ ok: false, error: 'At least one recipient is required' });
  if (!subject) return res.status(400).json({ ok: false, error: 'Subject is required' });
  if (!text && !html) return res.status(400).json({ ok: false, error: 'Email body is required' });
  const transport = getMailer();
  const info = await transport.sendMail({ from: SMTP_FROM, to, cc, bcc, subject, text, html, attachments });
  res.json({ ok: true, messageId: info.messageId, accepted: info.accepted });
}));


// POST /api/email/audit-submission
// Sends the "Audit Report Submitted" email for the given audit ids (once per audit; repeat calls are
// harmless). Called by the portal right after an audit is created, and usable by an admin as a resend.
router.post('/audit-submission', wrapAsync(async (req, res) => {
  requireRoles(req, ['admin', 'auditor'], 'Only Master Admin or Auditor can send audit report emails');
  const auditIds = (Array.isArray(req.body && req.body.auditIds) ? req.body.auditIds : []).map(String).slice(0, 30);
  const dryRun = Boolean(req.body && req.body.dryRun);
  res.json(await sendAuditSubmissionEmails({ auditIds, dryRun, by: actorOf(req) }));
}));


// GET /api/email/template-defaults : the built-in professional wording, used by the editor's "Restore default".
router.get('/template-defaults', wrapAsync(async (req, res) => {
  requireAdmin(req);
  res.json({ ok: true, templates: DEFAULT_TEMPLATES });
}));

function renderSample(body) {
  const type = TYPE_STYLE[String((body && body.type) || '')] ? String(body.type) : 'test';
  const tpl = { subject: String((body && body.subject) || ''), body: String((body && body.body) || '') };
  if (!tpl.subject.trim() || !tpl.body.trim()) { const err = new Error('Subject and body are required'); err.statusCode = 400; throw err; }
  return { type, ...renderEmail(tpl, type, sampleVars(type)) };
}

// POST /api/email/template-preview : renders a template (as typed in the editor) exactly as it would be sent.
router.post('/template-preview', wrapAsync(async (req, res) => {
  requireAdmin(req);
  const { subject, html } = renderSample(req.body);
  res.json({ ok: true, subject, html });
}));

// POST /api/email/template-test : sends that rendered sample to one address.
router.post('/template-test', wrapAsync(async (req, res) => {
  requireAdmin(req);
  const to = parseRecipients(req.body && req.body.to);
  if (to.length !== 1 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to[0])) return res.status(400).json({ ok: false, error: 'Enter one valid recipient email' });
  const { subject, html, text } = renderSample(req.body);
  await getMailer().sendMail({ from: SMTP_FROM, to, subject: `[TEST] ${subject}`, html, text });
  const collection = await getCollection();
  const current = await collection.findOne({ key: 'ap_email_logs' });
  const log = { id: `test_${Date.now()}`, type: 'test', to: to[0], cc: '', subject: `[TEST] ${subject}`, status: 'sent', sentAt: new Date().toISOString() };
  const value = mergeEmailLogs(current && current.value, [log], current && current.clearedAt);
  await collection.updateOne({ key: 'ap_email_logs' }, { $set: { key: 'ap_email_logs', value, updatedAt: new Date(), updatedBy: actorOf(req), clearedAt: (current && current.clearedAt) || null } }, { upsert: true });
  res.json({ ok: true });
}));

// POST /api/email/nc-reminder : the CAPA "Remind" button. One reminder per NC per day.
router.post('/nc-reminder', wrapAsync(async (req, res) => {
  requireRoles(req, ['admin', 'auditor', 'manager'], 'Only Master Admin, Auditor or Manager can send reminders');
  const result = await sendNcReminder({ findingId: req.body && req.body.findingId, by: actorOf(req) });
  res.status(result.ok ? 200 : (result.throttled ? 429 : 400)).json(result);
}));


// POST /api/email/monthly-summary : preview ({ dryRun: true }) or send now the Management summary for the
// previous month. `resend` sends it again even if it already went out this month.
router.post('/monthly-summary', wrapAsync(async (req, res) => {
  requireAdmin(req);
  const result = await sendMonthlySummary({ dryRun: Boolean(req.body && req.body.dryRun), resend: Boolean(req.body && req.body.resend), force: true, by: actorOf(req) });
  res.status(result.ok === false ? 400 : 200).json(result);
}));

// POST /api/email/run
// Admin-only manual trigger for the reminder engine that normally runs on the cron in server.js.
// Pass { dryRun: true } to preview exactly who would be mailed without sending anything.
router.post('/run', wrapAsync(async (req, res) => {
  requireAdmin(req);
  const dryRun = Boolean(req.body && req.body.dryRun);
  const by = actorOf(req);
  const summary = await runEmailAutomation({ by, dryRun });
  res.json(summary);
}));

// POST /api/email/log
router.post('/log', wrapAsync(async (req, res) => {
  const log = req.body && req.body.log;
  if (!log || typeof log !== 'object') return res.status(400).json({ ok: false, error: 'Email log is required' });
  const collection = await getCollection();
  const current = await collection.findOne({ key: 'ap_email_logs' });
  const now = new Date();
  const value = mergeEmailLogs(current && current.value, [log], current && current.clearedAt);
  await collection.updateOne({ key: 'ap_email_logs' }, { $set: { key: 'ap_email_logs', value, updatedAt: now, updatedBy: actorOf(req), clearedAt: current && current.clearedAt ? current.clearedAt : null } }, { upsert: true });
  res.json({ ok: true, count: value.length, value });
}));

// POST /api/email/locks/claim
// Claim only sets the short pending marker; the long nextAllowedAt window starts on commit (see email-locks.js).
router.post('/locks/claim', wrapAsync(async (req, res) => {
  const locks = normalizeEmailLockItems(req.body && req.body.locks);
  if (!locks.length) return res.status(400).json({ ok: false, error: 'At least one email lock is required' });
  const collection = await getCollection();
  const claimedBy = actorOf(req).slice(0, 80);
  const results = [];
  for (const item of locks) {
    const granted = await claimEmailLock(collection, item.key, item.frequencyDays, item.meta, claimedBy);
    results.push({ key: item.key, granted });
  }
  res.json({ ok: true, locks: results });
}));

// POST /api/email/locks/commit
router.post('/locks/commit', wrapAsync(async (req, res) => {
  const locks = normalizeEmailLockItems(req.body && req.body.locks);
  if (!locks.length) return res.status(400).json({ ok: false, error: 'At least one email lock is required' });
  const collection = await getCollection();
  const now = new Date();
  const success = Boolean(req.body && req.body.success);
  const committedBy = actorOf(req).slice(0, 80);
  const pendingUntil = new Date(0);
  const results = [];
  for (const item of locks) {
    const nextAllowedAt = new Date(now.getTime() + item.frequencyDays * 24 * 60 * 60 * 1000);
    const update = success
      ? { $set: { frequencyDays: item.frequencyDays, lastSentAt: now, nextAllowedAt, pendingUntil, committedAt: now, committedBy, meta: item.meta } }
      : { $set: { frequencyDays: item.frequencyDays, lastFailedAt: now, nextAllowedAt: pendingUntil, pendingUntil, committedAt: now, committedBy, meta: item.meta } };
    const result = await collection.updateOne({ key: emailSendLockKey(item.key) }, update);
    results.push({ key: item.key, updated: result.modifiedCount > 0 });
  }
  res.json({ ok: true, locks: results });
}));

module.exports = router;
