'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const sections = [
  { id: 'iso', title: 'ISO 9001 Audit Checkpoints', stdId: 'iso9001', clause: 'ISO 9001', _checkpoints: [{ id: 'q1', text: 'Are documents controlled?', clause: '7.5.2', tip: 'Review approval records' }] },
  { id: 'internal', title: 'OnePWS Internal Checkpoints', stdId: 'internal', clause: 'Internal', _checkpoints: [{ id: 'q2', text: 'Are training records current?', clause: '7.2', tip: 'Check training matrix' }] },
];

test('search matches question text, clause, tip and standard across all sections', async () => {
  const { searchAuditQuestions } = await import('../../client/src/utils/executionQuestions.js');
  for (const [query, id] of [['DOCUMENTS', 'q1'], ['7.2', 'q2'], ['approval', 'q1'], ['internal', 'q2'], ['  training   matrix ', 'q2']]) {
    assert.deepEqual(searchAuditQuestions(sections, query).map(r => r.question.id), [id]);
  }
  assert.equal(searchAuditQuestions(sections, 'records').length, 2);
  assert.deepEqual(searchAuditQuestions(sections, 'no-such-question'), []);
});

test('search preserves question identities and section locations without changing audit answers or findings', async () => {
  const { searchAuditQuestions } = await import('../../client/src/utils/executionQuestions.js');
  const session = { answers: { q1: 'yes', q2: 'no' }, findings: { q2: { desc: 'Training record missing' } }, notes: { q1: 'Checked' } };
  const before = JSON.stringify({ sections, session });
  const rows = searchAuditQuestions(sections, 'training');
  assert.equal(rows[0].question, sections[1]._checkpoints[0]);
  assert.equal(rows[0].section, sections[1]);
  assert.equal(rows[0].sectionIndex, 1);
  assert.equal(session.answers[rows[0].question.id], 'no');
  assert.equal(session.findings[rows[0].question.id].desc, 'Training record missing');
  assert.equal(searchAuditQuestions(sections, '').length, 2);
  assert.equal(JSON.stringify({ sections, session }), before);
});
