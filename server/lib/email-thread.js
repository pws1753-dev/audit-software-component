'use strict';

// One continuous email conversation per department, and a reminder counter per NC.
//
//  * Thread  (_mail_thread_<hash>): the Message-ID chain and a short history of what was sent, so each
//    new email replies to the previous one (Gmail / Outlook show a single conversation) and can list
//    the earlier messages inside the email itself.
//  * NC state (_nc_reminder_<hash>): how many reminders an NC has had and the day of the last one. It
//    drives the cadence: first reminder shortly before the target date, then every `repeatDays`.
//
// Both live in the same `appdata` collection as everything else, under keys that start with "_".

const crypto = require('crypto');

const THREAD_PREFIX = '_mail_thread_';
const NC_PREFIX = '_nc_reminder_';
const DAY_MS = 24 * 60 * 60 * 1000;
const THREAD_IDLE_DAYS = 60;   // a conversation untouched this long is closed and a new one starts
const MAX_HISTORY = 40;
const MAX_IDS = 30;

const hash = value => crypto.createHash('sha1').update(String(value || '').trim().toUpperCase()).digest('hex').slice(0, 24);
const threadKey = dept => THREAD_PREFIX + hash(dept);
const ncKey = id => NC_PREFIX + hash(id);

function mailDomain(from) {
  const m = /@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/.exec(String(from || ''));
  return m ? m[1].toLowerCase() : 'onepws.com';
}

async function loadThread(collection, dept) {
  const row = await collection.findOne({ key: threadKey(dept) });
  const t = row && row.value;
  if (!t || !Array.isArray(t.ids) || !t.ids.length) return null;
  if (t.lastAt && Date.now() - Date.parse(t.lastAt) > THREAD_IDLE_DAYS * DAY_MS) return null;
  return t;
}

// Everything needed to send the next message of a department's conversation.
//   n        : position in the conversation (1 = first email)
//   subject  : identical for every message ("Re: " is added from the second one)
//   headers  : messageId / inReplyTo / references for nodemailer
//   history  : earlier messages, oldest first, for display inside the email
async function nextMessage(collection, { dept, deptName, from }) {
  const thread = await loadThread(collection, dept);
  const n = thread ? thread.count + 1 : 1;
  const base = thread ? thread.subject : `NC Closure Follow-up - ${deptName || dept}`;
  const messageId = `<auditpro.${hash(dept)}.${n}.${Date.now().toString(36)}@${mailDomain(from)}>`;
  const ids = thread ? thread.ids : [];
  return {
    n, thread, base, messageId,
    subject: n === 1 ? base : `Re: ${base}`,
    headers: {
      messageId,
      ...(ids.length ? { inReplyTo: ids[ids.length - 1], references: ids.join(' ') } : {}),
      headers: { 'Thread-Topic': base, 'X-AuditPro-Thread': hash(dept) },
    },
    history: thread ? thread.history : [],
  };
}

// Record a message that was actually sent.
async function recordMessage(collection, { dept, msg, entry }) {
  const key = threadKey(dept);
  const now = new Date().toISOString();
  const prev = msg.thread;
  const ids = (prev ? prev.ids : []).concat(msg.messageId);
  const keptIds = ids.length > MAX_IDS ? [ids[0], ...ids.slice(ids.length - (MAX_IDS - 1))] : ids;
  const history = (prev ? prev.history : []).concat({ n: msg.n, at: now, ...entry }).slice(-MAX_HISTORY);
  const value = { dept, subject: msg.base, count: msg.n, createdAt: prev ? prev.createdAt : now, lastAt: now, ids: keptIds, history };
  await collection.updateOne({ key }, { $set: { key, value, updatedAt: new Date() } }, { upsert: true });
  return value;
}

async function loadNcStates(collection) {
  const rows = await collection.find({ key: { $regex: '^' + NC_PREFIX } }).toArray();
  return new Map(rows.map(r => [r.key, r.value || {}]));
}

async function saveNcStates(collection, updates) {
  if (!updates.length) return;
  const now = new Date();
  await collection.bulkWrite(updates.map(({ id, value }) => ({
    updateOne: { filter: { key: ncKey(id) }, update: { $set: { key: ncKey(id), value, updatedAt: now } }, upsert: true },
  })));
}

module.exports = { THREAD_PREFIX, NC_PREFIX, THREAD_IDLE_DAYS, DAY_MS, threadKey, ncKey, mailDomain, loadThread, nextMessage, recordMessage, loadNcStates, saveNcStates };
