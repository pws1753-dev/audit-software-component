'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

// Exercise the real Express route handlers and merge logic without a database,
// credentials, emails or a listening network port.
let data;
let writes;
const clone = value => value === undefined ? undefined : structuredClone(value);
const collection = {
  find: () => ({ toArray: async () => [...data.values()].map(clone) }),
  findOne: async ({ key }) => clone(data.get(key) || null),
  updateOne: async (filter, update) => {
    const { key } = filter;
    writes++;
    if (update.$setOnInsert) { if (!data.has(key)) data.set(key, clone(update.$setOnInsert)); return { modifiedCount: 0 }; }
    const row = data.get(key) || {};
    if (update.$push) {
      if (row.value.some(cp => cp.id === filter['value.id'].$ne)) return { modifiedCount: 0 };
      row.value.push(clone(update.$push.value));
    }
    data.set(key, { ...row, ...clone(update.$set) });
    return { modifiedCount: 1 };
  },
  bulkWrite: async operations => { for (const { updateOne: op } of operations) await collection.updateOne(op.filter, op.update); },
};
function stub(path, exports) { require.cache[require.resolve(path)] = { id: require.resolve(path), filename: require.resolve(path), loaded: true, exports }; }
const forbid = () => { const error = new Error('Forbidden'); error.statusCode = 403; throw error; };
stub('../lib/mongo', { getCollection: async () => collection });
stub('../lib/email-engine', { sendDueAuditSubmissionEmails: async () => { throw new Error('Unexpected email'); } });
stub('../middleware/auth', {
  wrapAsync: fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next),
  requireAdmin: req => { if (req.authUser.role !== 'admin') forbid(); },
  requirePageAccess: async () => forbid(), actorOf: req => req.authUser.id, invalidateAuthCaches: () => {},
});
const router = require('../routes/sync');
const head = { id: 'head', role: 'manager', accessScope: 'businessUnit', businessUnits: ['CD'] };
function reset() {
  writes = 0;
  data = new Map(Object.entries({
    ap_depts: [{ code: 'DES', name: 'Design', businessUnit: 'CD' }, { code: 'PRD', name: 'Production', businessUnit: 'CR' }],
    ap_finds: [{ id: 'f1', ref: 'NC1', dept: 'DES', desc: 'Visible' }, { id: 'f2', ref: 'NC2', dept: 'PRD', desc: 'Hidden' }],
    ap_learns: [{ id: 'l1', dept: 'DES' }, { id: 'l2', dept: 'PRD' }],
    ap_local_storage_backup: { data: { ap_finds: [{ desc: 'Secret' }] } },
    ap_users: [head, { id: 'admin', role: 'admin', passwordHash: 'secret' }],
  }).map(([key, value]) => [key, { key, value, updatedAt: '2026-11-17T00:00:00Z' }]));
}
function request(method, path, { key, body, query = {}, user = head } = {}) {
  const layer = router.stack.find(l => l.route?.path === path && l.route.methods[method]);
  return new Promise((resolve, reject) => {
    const req = { authUser: user, params: { key }, query, body };
    const res = { json: resolve, setHeader() {} };
    layer.route.stack[0].handle(req, res, reject);
  });
}

test('full sync and direct key reads enforce identical BU boundaries', async () => {
  reset();
  const full = await request('get', '/');
  const direct = await request('get', '/:key', { key: 'ap_finds' });
  assert.deepEqual(full.data.ap_finds.value, direct.value);
  assert.deepEqual(direct.value.map(f => f.id), ['f1']);
  assert.equal(full.data.ap_local_storage_backup.value, null);
  assert.deepEqual(full.data.ap_users.value.map(u => u.id), ['head']);
  const admin = await request('get', '/:key', { key: 'ap_finds', user: { role: 'admin' } });
  assert.equal(admin.value.length, 2);
});

test('BU scope is enforced for viewer-style BU accounts, not only managers', async () => {
  reset();
  const user = { id: 'buh.CR', role: 'viewer', dept: 'CR' };
  const full = await request('get', '/', { user });
  assert.equal(full.user.accessScope, 'businessUnit');
  assert.deepEqual(full.user.businessUnits, ['CR']);
  assert.deepEqual(full.data.ap_depts.value.map(d => d.code), ['PRD']);
  assert.deepEqual(full.data.ap_finds.value.map(f => f.id), ['f2']);
  assert.deepEqual(full.data.ap_learns.value.map(l => l.id), ['l2']);
});

test('department SPOC sync cannot return a sibling department in the same BU', async () => {
  reset();
  data.get('ap_depts').value.push({ code: 'ENG', name: 'Engineering', businessUnit: 'CR' });
  data.get('ap_finds').value.push({ id: 'f3', ref: 'NC3', dept: 'ENG', desc: 'Sibling' });
  const user = { id: 'spoc.prd', loginId: 'spoc.prd', role: 'spoc', dept: 'PRD' };
  const full = await request('get', '/', { user });
  assert.equal(full.user.accessScope, 'department');
  assert.deepEqual(full.user.departmentAccess, ['PRD']);
  assert.deepEqual(full.data.ap_finds.value.map(f => f.id), ['f2']);
});

test('assigned manager and viewer sync is restricted to their department', async () => {
  for (const role of ['manager', 'viewer']) {
    reset();
    const full = await request('get', '/', { user: { id: `${role}.prd`, role, dept: 'PRD' } });
    assert.equal(full.user.accessScope, 'department');
    assert.deepEqual(full.data.ap_finds.value.map(f => f.id), ['f2']);
  }
});

test('sync reads return one canonical row per finding reference', async () => {
  reset();
  data.get('ap_finds').value.push({ id: 'duplicate-id', ref: 'NC1', dept: 'DES', desc: 'Visible duplicate' });
  const full = await request('get', '/', { user: { role: 'admin' } });
  const direct = await request('get', '/:key', { key: 'ap_finds', user: { role: 'admin' } });
  assert.equal(full.data.ap_finds.value.filter(f => f.ref === 'NC1').length, 1);
  assert.equal(direct.value.filter(f => f.ref === 'NC1').length, 1);
});

test('department SPOC saves preserve sibling-department findings', async () => {
  reset();
  data.get('ap_depts').value.push({ code: 'ENG', name: 'Engineering', businessUnit: 'CR' });
  data.get('ap_finds').value.push({ id: 'f3', ref: 'NC3', dept: 'ENG', desc: 'Sibling' });
  const user = { id: 'spoc.prd', loginId: 'spoc.prd', role: 'spoc', dept: 'PRD' };
  await request('put', '/:key', {
    key: 'ap_finds', user,
    body: { value: [{ id: 'f2', ref: 'NC2', dept: 'PRD', desc: 'Updated by SPOC', updatedAt: '2026-11-21T10:00:00Z' }] },
  });
  assert.equal(data.get('ap_finds').value.find(f => f.id === 'f2').desc, 'Updated by SPOC');
  assert.equal(data.get('ap_finds').value.find(f => f.id === 'f3').desc, 'Sibling');
  assert.equal(data.get('ap_finds').value.find(f => f.id === 'f1').desc, 'Visible');
});

test('PUT and bulk save visible findings without dropping hidden records', async () => {
  for (const bulk of [false, true]) {
    reset();
    const value = [{ id: 'f1', ref: 'NC1', dept: 'DES', desc: 'Updated', updatedAt: new Date().toISOString() }];
    await request(bulk ? 'post' : 'put', bulk ? '/bulk' : '/:key', { key: 'ap_finds', body: bulk ? { items: { ap_finds: value } } : { value } });
    assert.equal(data.get('ap_finds').value.find(f => f.id === 'f1').desc, 'Updated');
    assert.equal(data.get('ap_finds').value.find(f => f.id === 'f2').desc, 'Hidden');
  }
});

test('both write endpoints reject cross-unit reassignment before any database mutation', async () => {
  for (const bulk of [false, true]) {
    reset();
    const value = [{ id: 'f2', ref: 'NC2', dept: 'DES', desc: 'Forged' }];
    await assert.rejects(request(bulk ? 'post' : 'put', bulk ? '/bulk' : '/:key', { key: 'ap_finds', body: bulk ? { items: { ap_finds: value } } : { value } }), { statusCode: 403 });
    assert.equal(writes, 0);
  }
});

test('rejected multi-key bulk requests do not partially save valid findings', async () => {
  reset();
  await assert.rejects(request('post', '/bulk', { body: { items: { ap_finds: [{ id: 'f1', ref: 'NC1', dept: 'DES', desc: 'Changed' }], ap_notifs: [] } } }), { statusCode: 403 });
  assert.equal(writes, 0);
});

test('scoped learning saves preserve other units on both endpoints', async () => {
  for (const bulk of [false, true]) {
    reset();
    const value = [{ id: 'l1', dept: 'DES' }, { id: 'l3', dept: 'DES', title: 'New' }];
    await request(bulk ? 'post' : 'put', bulk ? '/bulk' : '/:key', { key: 'ap_learns', body: bulk ? { items: { ap_learns: value } } : { value } });
    assert.deepEqual(data.get('ap_learns').value.map(l => l.id).sort(), ['l1', 'l2', 'l3']);
  }
});

test('access version changes with department mappings and BUH assignments', async () => {
  reset();
  const first = await request('get', '/');
  data.get('ap_depts').updatedAt = '2026-11-17T01:00:00Z';
  data.get('ap_depts').value[0].businessUnit = 'CR';
  const second = await request('get', '/', { query: { manifest: '1' } });
  assert.notEqual(first.accessVersion, second.accessVersion);
  const empty = await request('get', '/');
  assert.deepEqual(empty.data.ap_finds.value, []);
  const assigned = await request('get', '/', { user: { ...head, businessUnits: ['CR'] } });
  assert.notEqual(empty.accessVersion, assigned.accessVersion);
  assert.equal(assigned.data.ap_finds.value.length, 2);
});

test('department edits do not reset access for existing unscoped users', async () => {
  reset();
  const user = { id: 'admin', role: 'admin' };
  const before = await request('get', '/', { user });
  data.get('ap_depts').updatedAt = '2026-11-17T03:00:00Z';
  const after = await request('get', '/', { user });
  assert.equal(before.accessVersion, after.accessVersion);
});

test('only admins and auditors can add questions to the internal master library', async () => {
  reset();
  for (const user of [head, { role: 'spoc' }, { role: 'viewer' }, { role: 'manager' }]) {
    await assert.rejects(request('post', '/internal-checkpoint', { body: { text: 'Question', dept: 'DES', weight: 3 }, user }), { statusCode: 403 });
  }
  assert.equal(writes, 0);
});

test('internal-question route saves for both authorized roles and records the authenticated actor', async () => {
  reset();
  for (const role of ['admin', 'auditor']) {
    const user = { id: role, role };
    const result = await request('post', '/internal-checkpoint', { user, body: { text: role + ' question', dept: 'DES', weight: 3, updatedBy: 'forged-actor' } });
    assert.equal(result.created, true);
    assert.equal(data.get('ap_cps').updatedBy, role);
    assert.equal(result.checkpoint.standard, 'internal');
  }
  assert.equal(data.get('ap_cps').value.length, 2);
});
