'use strict';
// Merge a duplicate department record into the real one: removes the duplicate from the Master Library
// and the Email Master, and moves its users. Refuses to change anything while findings, audits, drafts,
// checkpoints, learnings or media still refer to the duplicate.
//
//   node server/scripts/merge-duplicate-dept.js SAPS SPS           report only
//   node server/scripts/merge-duplicate-dept.js SAPS SPS --apply   make the changes
//
// Take a backup first:  node server/scripts/backup-db.js
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const { getCollection } = require('../lib/mongo');
const APPLY = process.argv.includes('--apply');
const [OLD, KEEP] = process.argv.slice(2).filter(a => !a.startsWith('--'));
if (!OLD || !KEEP) { console.error('Usage: node server/scripts/merge-duplicate-dept.js <DUPLICATE_CODE> <KEEP_CODE> [--apply]'); process.exit(1); }

(async () => {
  const c = await getCollection();
  const row = async k => c.findOne({ key: k });
  const val = r => (r && r.value) || [];
  const [depts, master, users, rules, finds, aud, drafts, planned, cps, learns, media] = await Promise.all(
    ['ap_depts', 'ap_email_master', 'ap_users', 'ap_email_rules', 'ap_finds', 'ap_completed_audits', 'ap_audit_drafts', 'ap_planned_audits', 'ap_cps', 'ap_learns', 'ap_media_library'].map(row));

  const hasOld = v => JSON.stringify(v).includes('"' + OLD + '"');
  console.log(`References to ${OLD}:`);
  const refs = {
    'findings': val(finds).filter(f => f.dept === OLD ).length,
    'audits': val(aud).filter(a => a.dept === OLD ).length,
    'audit drafts': val(drafts).filter(d => hasOld(d)).length,
    'planned audits': val(planned).filter(d => hasOld(d)).length,
    'checkpoints': val(cps).filter(d => d.dept === OLD ).length,
    'learnings': val(learns).filter(d => hasOld(d)).length,
    'media library': val(media).filter(d => d.dept === OLD).length,
  };
  Object.entries(refs).forEach(([k, n]) => console.log('  ' + k.padEnd(16) + n));
  const blocking = Object.values(refs).reduce((a, b) => a + b, 0);
  const rd = rules && rules.value && rules.value.depts && rules.value.depts[OLD];
  console.log(`  email rules for ${OLD}:`, rd ? JSON.stringify(rd) : 'none');
  const oldDept = val(depts).filter(d => d.code === OLD), oldMaster = val(master).filter(m => m.deptCode === OLD), oldUsers = val(users).filter(u => u.dept === OLD);
  console.log('\nTo remove / change:');
  console.log('  department record:', oldDept.map(d => d.code + ' "' + d.name + '"').join(', ') || 'none');
  console.log('  Email Master record:', oldMaster.map(m => m.id).join(', ') || 'none');
  console.log('  users moved to ' + KEEP + ':', oldUsers.map(u => u.loginId).join(', ') || 'none');
  if (blocking) { console.log('\nSTOP: something still refers to ' + OLD + '; not changing anything.'); process.exit(3); }
  if (!APPLY) { console.log('\n(report only; run with --apply to change)'); process.exit(0); }

  const upd = async (key, mutate) => {
    const r = await row(key); const before = r.value; const after = mutate(before);
    const res = await c.updateOne({ key, updatedAt: r.updatedAt }, { $set: { value: after, updatedAt: new Date(), updatedBy: 'merge-duplicate-dept' } });
    console.log('  ' + key.padEnd(18), res.modifiedCount ? 'updated' : 'NOT updated (changed meanwhile, re-run)');
  };
  console.log('\nApplying:');
  if (oldDept.length) await upd('ap_depts', v => v.filter(d => d.code !== OLD));
  if (oldMaster.length) await upd('ap_email_master', v => v.filter(m => m.deptCode !== OLD));
  if (oldUsers.length) await upd('ap_users', v => v.map(u => (u.dept === OLD ? { ...u, dept: KEEP } : u)));
  if (rd) await upd('ap_email_rules', v => { const d = { ...(v.depts || {}) }; delete d[OLD]; return { ...v, depts: d }; });
  process.exit(0);
})().catch(e => { console.error(e.stack); process.exit(1); });
