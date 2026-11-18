'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

test('Common is always available and Business Unit department filtering is case-insensitive', async () => {
  const { COMMON_BUSINESS_UNIT, businessUnitOptions, departmentsInBusinessUnit } = await import('../../client/src/utils/businessUnits.js');
  const departments = [
    { code: 'HR', businessUnit: 'Common' },
    { code: 'DES', businessUnit: 'CD' },
  ];
  assert.equal(COMMON_BUSINESS_UNIT, 'Common');
  assert.ok(businessUnitOptions(departments).includes('Common'));
  assert.deepEqual(departmentsInBusinessUnit(departments, ' common '), [departments[0]]);
  assert.equal(departmentsInBusinessUnit(departments, '').length, 2);
});
