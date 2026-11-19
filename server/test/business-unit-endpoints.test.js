'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const head = { id: 'head', role: 'manager', accessScope: 'businessUnit', businessUnits: ['CD'] };
const rows = {
  ap_depts: [{ code: 'DES', businessUnit: 'CD' }, { code: 'PRD', businessUnit: 'CR' }],
  ap_finds: [{ id: 'f1', ref: 'NC1', dept: 'DES' }, { id: 'f2', ref: 'NC2', dept: 'PRD' }],
  ap_media_library: [{ id: 'm1', dept: 'DES' }, { id: 'm2', dept: 'PRD' }, { id: 'm3' }],
};
const sent = [];
function stub(path, exports) { require.cache[require.resolve(path)] = { id: require.resolve(path), filename: require.resolve(path), loaded: true, exports }; }
stub('../lib/mongo', { getCollection: async () => ({ findOne: async ({ key }) => ({ key, value: rows[key] }) }) });
stub('../middleware/auth', {
  wrapAsync: fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next),
  requireRoles: (req, roles) => { if (!roles.includes(req.authUser.role)) { const error = new Error('Forbidden'); error.statusCode = 403; throw error; } },
  actorOf: req => req.authUser.id,
});
stub('../lib/cloudinary', {});
stub('../lib/mailer', {});
stub('../lib/email-locks', {});
stub('../lib/email-render', {});
stub('../lib/email-engine', { sendNcReminder: async options => { sent.push(options); return { ok: true }; } });
const media = require('../routes/media');
const email = require('../routes/email');

function request(router, method, path, body, user = head) {
  const layer = router.stack.find(l => l.route?.path === path && l.route.methods[method]);
  let status = 200;
  return new Promise((resolve, reject) => {
    const res = { status: code => { status = code; return res; }, json: data => resolve({ status, ...data }) };
    layer.route.stack[0].handle({ authUser: user, body }, res, reject);
  });
}

test('media endpoint hides other-unit and unassigned assets from BUH', async () => {
  const result = await request(media, 'get', '/list');
  assert.deepEqual(result.items.map(item => item.id), ['m1']);
  assert.equal(result.count, 1);
  const admin = await request(media, 'get', '/list', null, { role: 'admin' });
  assert.equal(admin.count, 3);
});

test('reminders are allowed by finding ID/ref only within assigned units', async () => {
  sent.length = 0;
  for (const findingId of ['f1', 'NC1']) assert.equal((await request(email, 'post', '/nc-reminder', { findingId })).ok, true);
  for (const findingId of ['f2', 'NC2', 'unknown', '']) assert.equal((await request(email, 'post', '/nc-reminder', { findingId })).status, 403);
  assert.equal(sent.length, 2);
});

test('global email-log endpoint cannot return logs to a BUH', async () => {
  assert.equal((await request(email, 'post', '/log', { log: { subject: 'Test' } })).status, 403);
  assert.equal((await request(email, 'post', '/log', { log: { subject: 'Test' } }, { id: 'buh.cr', role: 'viewer', dept: 'CR' })).status, 403);
});

test('legacy inferred BU manager cannot remind a finding from another unit', async () => {
  const user = { id: 'buh.cr', role: 'manager', dept: 'CR' };
  assert.equal((await request(email, 'post', '/nc-reminder', { findingId: 'f2' }, user)).ok, true);
  assert.equal((await request(email, 'post', '/nc-reminder', { findingId: 'f1' }, user)).status, 403);
});
