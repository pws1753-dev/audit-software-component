'use strict';
// Remove an address from every automatic email of some departments (it stays on all the others).
// Writes the department's "Never email or CC" list in the Email Center rules (the same setting as
// Email Center > Who Gets Emailed > department > "Never email or CC").
//
//   node server/scripts/exclude-dept-cc.js ankit.chittora@onepws.com PEC CS2 CP2 CD2 CQ2 CSI2           report only
//   node server/scripts/exclude-dept-cc.js ankit.chittora@onepws.com PEC CS2 CP2 CD2 CQ2 CSI2 --apply   save it
//
// Take a backup first:  node server/scripts/backup-db.js
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const { getCollection } = require('../lib/mongo');

const APPLY = process.argv.includes('--apply');
const [EMAIL, ...CODES] = process.argv.slice(2).filter(a => !a.startsWith('--'));
if (!EMAIL || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(EMAIL) || !CODES.length) {
  console.error('Usage: node server/scripts/exclude-dept-cc.js <email> <DEPT_CODE> [<DEPT_CODE> ...] [--apply]');
  process.exit(1);
}

(async () => {
  const c = await getCollection();
  const depts = (await c.findOne({ key: 'ap_depts' })).value || [];
  const row = await c.findOne({ key: 'ap_email_rules' });
  const rules = (row && row.value) || {};
  const known = new Set(depts.map(d => d.code));
  const bad = CODES.filter(code => !known.has(code));
  if (bad.length) { console.error('Unknown department code(s):', bad.join(', ')); process.exit(2); }

  const next = { ...rules, depts: { ...(rules.depts || {}) } };
  console.log(`${APPLY ? 'Applying' : 'Would apply'}: never email or CC ${EMAIL} in:`);
  CODES.forEach(code => {
    const cur = next.depts[code] || {};
    const list = Array.from(new Set([...(cur.excludeCc || []), EMAIL.toLowerCase()]));
    next.depts[code] = { ...cur, excludeCc: list };
    const d = depts.find(x => x.code === code);
    console.log(`  ${code.padEnd(5)} ${d.name.padEnd(26)} excluded: ${list.join(', ')}`);
  });
  if (!APPLY) { console.log('\n(report only; run with --apply to save)'); process.exit(0); }
  const res = await c.updateOne({ key: 'ap_email_rules', updatedAt: row && row.updatedAt }, { $set: { value: next, updatedAt: new Date(), updatedBy: 'exclude-dept-cc' } });
  console.log(res.modifiedCount ? '\nSaved.' : '\nNOT saved: the rules changed while this ran. Run it again.');
  process.exit(res.modifiedCount ? 0 : 3);
})().catch(e => { console.error(e.stack); process.exit(1); });
