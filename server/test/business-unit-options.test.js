'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

test('Common is always available and Business Unit department filtering is case-insensitive', async () => {
  const { COMMON_BUSINESS_UNIT, assignedBusinessUnits, businessUnitOptions, departmentsInBusinessUnit, isBusinessUnitScoped } = await import('../../client/src/utils/businessUnits.js');
  const departments = [
    { code: 'HR', businessUnit: 'Common' },
    { code: 'DES', businessUnit: 'CD' },
  ];
  assert.equal(COMMON_BUSINESS_UNIT, 'Common');
  assert.ok(businessUnitOptions(departments).includes('Common'));
  assert.deepEqual(departmentsInBusinessUnit(departments, ' common '), [departments[0]]);
  assert.equal(departmentsInBusinessUnit(departments, '').length, 2);
  assert.deepEqual(assignedBusinessUnits({ role: 'viewer', accessScope: 'businessUnit', businessUnits: [' CR ', 'cr'] }), ['CR']);
  assert.equal(isBusinessUnitScoped({ role: 'viewer', accessScope: 'businessUnit' }), true);
  assert.equal(isBusinessUnitScoped({ role: 'admin', accessScope: 'businessUnit' }), false);
});
