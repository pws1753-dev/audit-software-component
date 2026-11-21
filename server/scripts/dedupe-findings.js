'use strict';

// Removes duplicate finding references after preserving the strongest workflow copy.
// Dry-run by default. Usage:
//   node server/scripts/dedupe-findings.js
//   node server/scripts/dedupe-findings.js --apply
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const { MongoClient } = require('mongodb');
const { dedupeFindingsForSync } = require('../lib/sync-helpers');

async function main() {
  const apply = process.argv.includes('--apply');
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB || 'onepws_audit';
  if (!uri) throw new Error('MONGODB_URI is not set');
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const collection = client.db(dbName).collection('appdata');
    const row = await collection.findOne({ key: 'ap_finds' });
    const before = Array.isArray(row && row.value) ? row.value : [];
    const after = dedupeFindingsForSync(before);
    const removed = before.length - after.length;
    console.log(`Findings: ${before.length} -> ${after.length}; duplicate rows: ${removed}`);
    if (!apply || removed === 0) {
      console.log(apply ? 'No database change needed.' : 'Dry run only; use --apply after taking a backup.');
      return;
    }
    const result = await collection.updateOne(
      { key: 'ap_finds', updatedAt: row.updatedAt },
      { $set: { value: after, updatedAt: new Date(), updatedBy: 'dedupe-findings-script' } }
    );
    if (result.modifiedCount !== 1) throw new Error('Findings changed during cleanup; no rows were removed. Retry from a fresh backup.');
    console.log(`Applied: removed ${removed} duplicate row(s).`);
  } finally {
    await client.close();
  }
}

main().catch(error => { console.error('Finding cleanup failed:', error.message); process.exit(1); });
