'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { businessUnitAccess } = require('../lib/business-unit-access');
const { mergeFindingsForSync } = require('../lib/sync-helpers');

const departments = [
  { id: 'd1', code: 'DES', name: 'Design', businessUnit: 'CD' },
  { id: 'd2', code: 'PRD', name: 'Production', businessUnit: 'CR' },
  { id: 'd3', code: 'SAL', name: 'Sales', businessUnit: 'PWSFloors' },
  { id: 'd4', code: 'HR', name: 'Human Resources' },
];
const head = { id: 'head', role: 'manager', accessScope: 'businessUnit', businessUnits: [' cd ', 'PWSFloors'] };
const findings = [
  { id: 'f1', ref: 'NC1', dept: 'DES', desc: 'Design finding', status: 'open' },
  { id: 'f2', ref: 'NC2', dept: 'PRD', desc: 'Other unit finding', status: 'open' },
  { id: 'f3', ref: 'NC3', deptName: 'Sales', desc: 'Floor finding', status: 'open' },
  { id: 'f4', ref: 'NC4', dept: 'HR', desc: 'Unassigned finding', status: 'open' },
];

test('BUH sees only assigned units, using department codes, IDs and legacy names', () => {
  const access = businessUnitAccess(head, departments);
  assert.deepEqual(access.filter('ap_finds', findings).map(f => f.id), ['f1', 'f3']);
  assert.equal(access.allows({ dept: 'd1' }), true);
  assert.equal(access.allows({ department: ' design ' }), true);
  assert.equal(access.allows({ dept: 'PRD', deptName: 'Design' }), false);
  assert.equal(access.allows({ dept: 'unknown', businessUnit: 'CD' }), false);
  assert.equal(access.allows(null), false);
});

test('empty or removed assignments fail closed; every assigned non-admin role is scoped', () => {
  assert.deepEqual(businessUnitAccess({ ...head, businessUnits: [] }, departments).filter('ap_finds', findings), []);
  assert.deepEqual(businessUnitAccess(head, []).filter('ap_finds', findings), []);
  for (const role of ['auditor', 'manager', 'spoc', 'viewer']) {
    assert.deepEqual(businessUnitAccess({ role, accessScope: 'businessUnit', businessUnits: ['CR'] }, departments).filter('ap_finds', findings).map(f => f.id), ['f2']);
  }
  for (const user of [{ role: 'admin', accessScope: 'businessUnit', businessUnits: ['CR'] }, { role: 'auditor' }, { role: 'manager' }, { role: 'viewer' }]) {
    assert.equal(businessUnitAccess(user, departments).filter('ap_finds', findings), findings);
  }
  assert.deepEqual(businessUnitAccess({ role: 'spoc' }, departments).filter('ap_finds', findings), []);
});

test('legacy BU account is inferred from an exact configured Business Unit in dept', () => {
  const access = businessUnitAccess({ id: 'buh.cr', role: 'viewer', dept: 'CR' }, departments);
  assert.equal(access.scoped, true);
  assert.deepEqual(access.units, ['CR']);
  assert.deepEqual(access.filter('ap_finds', findings).map(f => f.id), ['f2']);
  assert.equal(businessUnitAccess({ role: 'viewer', dept: 'unknown' }, departments).scoped, false);
  assert.equal(businessUnitAccess({ role: 'admin', dept: 'CR' }, departments).scoped, false);
  assert.deepEqual(businessUnitAccess({ loginId: 'cdbuh', role: 'viewer' }, departments).units, ['CD']);
  assert.deepEqual(businessUnitAccess({ loginId: 'HUH.CR', role: 'viewer' }, departments).units, ['CR']);
  assert.equal(businessUnitAccess({ loginId: 'user.cr', role: 'viewer' }, departments).scoped, false);
});

test('a department SPOC is restricted to the assigned department, not its whole BU', () => {
  const withSibling = [...departments, { id: 'd5', code: 'ENG', name: 'Engineering', businessUnit: 'CR' }];
  const rows = [...findings, { id: 'f5', ref: 'NC5', dept: 'ENG', desc: 'Sibling department finding' }];
  const access = businessUnitAccess({ loginId: 'spoc.ccr', role: 'spoc', dept: 'PRD', accessScope: 'legacy' }, withSibling);
  assert.equal(access.scoped, true);
  assert.equal(access.departmentScoped, true);
  assert.deepEqual(access.departments, ['PRD']);
  assert.deepEqual(access.filter('ap_finds', rows).map(f => f.id), ['f2']);
});

test('all related collections are scoped and unstructured sources cannot leak findings', () => {
  const access = businessUnitAccess(head, departments);
  for (const key of ['ap_completed_audits', 'ap_planned_audits', 'ap_learns', 'ap_media_library', 'ap_email_master']) {
    assert.deepEqual(access.filter(key, findings).map(f => f.id), ['f1', 'f3']);
  }
  for (const key of ['ap_notifs', 'ap_import_logs', 'ap_email_logs', 'ap_audit_drafts', 'ap_email_templates', 'ap_auds']) {
    assert.deepEqual(access.filter(key, findings), []);
  }
  assert.equal(access.filter('ap_local_storage_backup', { data: { ap_finds: findings } }), null);
  assert.deepEqual(access.filter('ap_depts', departments).map(d => d.code), ['DES', 'SAL']);
  assert.deepEqual(access.filter('ap_users', [head, { id: 'other' }]), [head]);
});

test('global checkpoints remain usable but department checkpoints follow unit access', () => {
  const access = businessUnitAccess(head, departments);
  assert.deepEqual(access.filter('ap_cps', [{ id: 'global' }, { id: 'yes', dept: 'DES' }, { id: 'no', dept: 'PRD' }]).map(r => r.id), ['global', 'yes']);
});

test('scoped finding saves preserve every other unit and unassigned finding', () => {
  const access = businessUnitAccess(head, departments);
  const incoming = [{ ...findings[0], desc: 'Updated description', updatedAt: '2026-11-17T10:00:00Z' }, findings[2]];
  access.assertWrite('ap_finds', incoming, findings);
  const merged = mergeFindingsForSync(findings, incoming);
  assert.equal(merged.length, findings.length);
  assert.equal(merged.find(f => f.id === 'f1').desc, 'Updated description');
  for (const id of ['f2', 'f4']) assert.equal(merged.find(f => f.id === id).desc, findings.find(f => f.id === id).desc);
});

test('cross-unit edits, moves, forged identities, malformed payloads and restricted keys are rejected', () => {
  const access = businessUnitAccess(head, departments);
  const rejected = [
    findings[1], { ...findings[1], dept: 'DES' }, { ...findings[0], dept: 'PRD' },
    { ...findings[0], id: 'new-id' }, { ...findings[0], ref: 'NC2' }, null, {},
  ];
  for (const row of rejected) assert.throws(() => access.assertWrite('ap_finds', [row], findings), { statusCode: 403 });
  for (const key of ['ap_users', 'ap_depts', 'ap_permissions', 'ap_notifs', 'ap_local_storage_backup']) assert.throws(() => access.assertWrite(key, [], []), { statusCode: 403 });
  assert.throws(() => access.assertWrite('ap_finds', null, findings), { statusCode: 403 });
});

test('department remapping immediately removes old BU access and does not infer access from email or own department', () => {
  const moved = departments.map(d => d.code === 'DES' ? { ...d, businessUnit: 'CR' } : d);
  const access = businessUnitAccess({ ...head, dept: 'DES', email: 'head@example.com' }, moved);
  assert.equal(access.allows(findings[0]), false);
  assert.throws(() => access.assertWrite('ap_finds', [findings[0]], findings), { statusCode: 403 });
});

test('ambiguous legacy department names cannot cross unit boundaries', () => {
  const access = businessUnitAccess(head, [...departments, { code: 'DES2', name: 'Design', businessUnit: 'CR' }]);
  assert.equal(access.allows({ deptName: 'Design' }), false);
  assert.equal(access.allows({ dept: 'DES', deptName: 'Design' }), true);
});
