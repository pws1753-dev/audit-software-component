'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

test('new department users appear in the Email Master view without duplicate stored rows', async () => {
  const { emailMasterWithUsers } = await import('../../client/src/utils/emailMaster.js');
  const departments = [{ code: 'CRPUR', name: 'Purchase-CR', businessUnit: 'CR' }];
  const users = [{ id: 'rohit', role: 'spoc', dept: 'CRPUR', name: 'Mr. Rohit Joshi', email: 'rohit.joshi@onepws.com', active: true }];
  const result = emailMasterWithUsers([], users, departments);
  assert.equal(result.length, 1);
  assert.equal(result[0].deptCode, 'CRPUR');
  assert.equal(result[0].email, 'rohit.joshi@onepws.com');
  assert.equal(result[0].derivedFromUsers, true);
});

test('user emails augment an existing department row without mutating saved data', async () => {
  const { emailMasterWithUsers } = await import('../../client/src/utils/emailMaster.js');
  const departments = [{ code: 'CRPUR', name: 'Purchase-CR' }];
  const stored = [{ id: 'em1', deptCode: 'CRPUR', department: 'Purchase-CR', email: 'old@onepws.com' }];
  const users = [{ role: 'spoc', dept: 'CRPUR', name: 'Rohit', email: 'rohit.joshi@onepws.com' }];
  const result = emailMasterWithUsers(stored, users, departments);
  assert.equal(result[0].email, 'old@onepws.com, rohit.joshi@onepws.com');
  assert.equal(stored[0].email, 'old@onepws.com');
});
