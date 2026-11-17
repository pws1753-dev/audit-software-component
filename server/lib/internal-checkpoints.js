'use strict';

const crypto = require('crypto');
const normalized = value => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();

async function addInternalCheckpoint(collection, input) {
  const text = String(input?.text || '').trim();
  const dept = String(input?.dept || '').trim();
  const clause = String(input?.clause || '').trim() || 'Internal';
  const weight = Number(input?.weight ?? 3);
  if (!text || !dept || !Number.isInteger(weight) || weight < 1 || weight > 5) {
    const error = new Error('Question text, department and a weight from 1 to 5 are required');
    error.statusCode = 400;
    throw error;
  }
  const identity = [dept, text, clause].map(normalized);
  const row = await collection.findOne({ key: 'ap_cps' });
  const existing = (Array.isArray(row?.value) ? row.value : []).find(cp =>
    JSON.stringify([cp.dept, cp.text, cp.clause || 'Internal'].map(normalized)) === JSON.stringify(identity));
  if (existing) return { checkpoint: existing, created: false };
  const checkpoint = {
    id: 'cp_internal_' + crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0, 24),
    text, clause, weight, type: 'Yes/No', dept, tip: String(input?.tip || '').trim(), aiSuggestion: '', standard: 'internal',
  };
  // Initialize only when absent, then append conditionally. Never replace the whole
  // library: simultaneous additions and retries must preserve other checkpoints.
  await collection.updateOne({ key: 'ap_cps' }, { $setOnInsert: { key: 'ap_cps', value: [] } }, { upsert: true });
  const result = await collection.updateOne(
    { key: 'ap_cps', 'value.id': { $ne: checkpoint.id } },
    { $push: { value: checkpoint }, $set: { updatedAt: new Date(), updatedBy: input.updatedBy } }
  );
  if (!result.modifiedCount) {
    const current = await collection.findOne({ key: 'ap_cps' });
    const persisted = current?.value?.find(cp => cp.id === checkpoint.id);
    if (!persisted) {
      const error = new Error('The Master Library changed during saving. Please try again.');
      error.statusCode = 409;
      throw error;
    }
    return { checkpoint: persisted, created: false };
  }
  return { checkpoint, created: true };
}

module.exports = { addInternalCheckpoint };
