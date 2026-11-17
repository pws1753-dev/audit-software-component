'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { addInternalCheckpoint } = require('../lib/internal-checkpoints');

function memoryLibrary(initial) {
  let row = initial === undefined ? null : { key: 'ap_cps', value: structuredClone(initial) };
  return {
    findOne: async () => structuredClone(row),
    updateOne: async (filter, update) => {
      if (update.$setOnInsert) { if (!row) row = structuredClone(update.$setOnInsert); return { modifiedCount: 0 }; }
      if (row.value.some(cp => cp.id === filter['value.id'].$ne)) return { modifiedCount: 0 };
      row.value.push(structuredClone(update.$push.value));
      Object.assign(row, update.$set);
      return { modifiedCount: 1 };
    },
  };
}
const question = { text: 'Are training records current?', clause: '7.2', dept: 'DES', weight: 4, tip: 'Check training matrix', updatedBy: 'auditor' };

test('internal checkpoint is appended with department and reusable question fields; existing rows are preserved', async () => {
  const existing = { id: 'existing', text: 'Existing question', dept: 'PRD' };
  const collection = memoryLibrary([existing]);
  const result = await addInternalCheckpoint(collection, question);
  const row = await collection.findOne();
  assert.equal(result.created, true);
  assert.equal(row.value.length, 2);
  assert.deepEqual(row.value[0], existing);
  assert.equal(result.checkpoint.standard, 'internal');
  assert.equal(result.checkpoint.dept, question.dept);
  assert.equal(result.checkpoint.tip, question.tip);
  assert.equal(result.checkpoint.weight, question.weight);
  assert.equal(row.updatedBy, 'auditor');
});

test('repeated submissions and simultaneous identical additions create only one checkpoint', async () => {
  const collection = memoryLibrary([]);
  const results = await Promise.all(Array.from({ length: 8 }, () => addInternalCheckpoint(collection, question)));
  assert.equal((await collection.findOne()).value.length, 1);
  assert.equal(results.filter(r => r.created).length, 1);
  const retry = await addInternalCheckpoint(collection, { ...question, text: '  ARE  training records current?  ', dept: 'des' });
  assert.equal(retry.created, false);
  assert.equal(retry.checkpoint.id, results[0].checkpoint.id);
});

test('concurrent different questions are preserved and missing library is initialized', async () => {
  const collection = memoryLibrary();
  await Promise.all([
    addInternalCheckpoint(collection, question),
    addInternalCheckpoint(collection, { ...question, text: 'Are documents approved?' }),
    addInternalCheckpoint(collection, { ...question, dept: 'PRD' }),
  ]);
  assert.equal((await collection.findOne()).value.length, 3);
});

test('legacy master library duplicates are reused without changing their details', async () => {
  const legacy = { ...question, id: 'legacy', weight: 5, tip: 'Original tip' };
  const collection = memoryLibrary([legacy]);
  const result = await addInternalCheckpoint(collection, question);
  assert.equal(result.created, false);
  assert.deepEqual(result.checkpoint, legacy);
  assert.equal((await collection.findOne()).value.length, 1);
});

test('invalid question payloads are rejected before persistence', async () => {
  const collection = memoryLibrary([]);
  for (const patch of [{ text: '' }, { dept: '' }, { weight: 0 }, { weight: 6 }, { weight: 2.5 }, { weight: 'bad' }]) {
    await assert.rejects(addInternalCheckpoint(collection, { ...question, ...patch }), { statusCode: 400 });
  }
  assert.deepEqual((await collection.findOne()).value, []);
});

test('saved internal checkpoint is included in future audits for the linked department', async () => {
  const { buildChecklist } = await import('../../client/src/utils/auditEngine.js');
  const collection = memoryLibrary([]);
  const saved = await addInternalCheckpoint(collection, question);
  const library = (await collection.findOne()).value;
  const sections = buildChecklist('DES', ['internal'], [{ code: 'DES', name: 'Design' }], library);
  assert.equal(sections.length, 1);
  assert.equal(sections[0]._checkpoints[0].sourceId, saved.checkpoint.id);
  assert.equal(sections[0]._checkpoints[0].text, question.text);
  assert.deepEqual(buildChecklist('PRD', ['internal'], [], library), []);
});
