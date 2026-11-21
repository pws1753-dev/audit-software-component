'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

test('finding exports keep one row per reference and prefer the newest copy', async () => {
  const { uniqueFindingsByRef } = await import('../../client/src/utils/helpers.js');
  const old = { id: 'a', ref: 'PEC-2026-003', desc: 'old', updatedAt: '2026-11-19T10:00:00Z' };
  const latest = { id: 'b', ref: ' pec-2026-003 ', desc: 'latest', updatedAt: '2026-11-20T10:00:00Z' };
  const distinct = { id: 'a', ref: 'PEC-2026-004', desc: 'different reference' };
  const result = uniqueFindingsByRef([old, distinct, latest]);
  assert.deepEqual(result.map(row => row.ref), [' pec-2026-003 ', 'PEC-2026-004']);
  assert.equal(result[0].desc, 'latest');
});

test('finding exports do not collapse different references that reused an imported ID', async () => {
  const { uniqueFindingsByRef } = await import('../../client/src/utils/helpers.js');
  const result = uniqueFindingsByRef([
    { id: 'reused', ref: 'CRPUR-2026-002' },
    { id: 'reused', ref: 'CRPUR-2026-003' },
  ]);
  assert.equal(result.length, 2);
});
