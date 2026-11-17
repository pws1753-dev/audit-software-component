import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { Card, Badge, Icon } from '../components/UI';
import { SEV_BADGE, SEV_LABEL, showToast } from '../utils/helpers';
import { exportLearningsWorkbook, downloadLearningsTemplate, parseLearningsWorkbook } from '../utils/learningsExcel';

export default function Learnings() {
  const { getLearnings, getDepts, getDeptOptions, writeSyncKey, currentUser, setPageAction } = useApp();
  const learnings = getLearnings();
  const deptOptions = getDeptOptions();
  const allDepts = getDepts();
  const role = currentUser?.role;
  const canBulk = role === 'admin' || role === 'auditor';

  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ title: '', dept: '', sev: 'major', clause: '', rc: '', pa: '', repeat: false, crossDept: false });
  const titleInputRef = useRef(null);
  const importInputRef = useRef(null);
  const [importPreview, setImportPreview] = useState(null);

  useEffect(() => {
    setPageAction(() => () => { titleInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); titleInputRef.current?.focus(); });
    return () => setPageAction(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return learnings;
    return learnings.filter(l => [l.title, l.rc, l.pa, l.clause].join(' ').toLowerCase().includes(q));
  }, [learnings, search]);

  const addLearning = () => {
    if (!form.title.trim()) { showToast('Title required'); return; }
    if (currentUser?.accessScope === 'businessUnit' && !form.dept) { showToast('Select a department in your assigned Business Units'); return; }
    const item = { id: 'l' + Date.now(), title: form.title.trim(), dept: form.dept, sev: form.sev, clause: form.clause, rc: form.rc, pa: form.pa, repeat: form.repeat, crossDept: form.crossDept };
    writeSyncKey('ap_learns', [item, ...getLearnings()], currentUser?.loginId);
    setForm({ title: '', dept: '', sev: 'major', clause: '', rc: '', pa: '', repeat: false, crossDept: false });
    showToast('Learning saved!');
  };

  const delLearning = (id) => { writeSyncKey('ap_learns', getLearnings().filter(x => x.id !== id), currentUser?.loginId); showToast('Deleted'); };

  const exportExcel = () => {
    try {
      const n = exportLearningsWorkbook(learnings, allDepts);
      showToast(`Exported ${n} learning(s)`);
    } catch (err) { showToast(err.message); }
  };
  const exportTemplate = () => {
    try { downloadLearningsTemplate(allDepts); showToast('Template downloaded'); } catch (err) { showToast(err.message); }
  };
  const onImportFile = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        setImportPreview({ name: file.name, ...parseLearningsWorkbook(new Uint8Array(ev.target.result), { depts: allDepts, existing: getLearnings() }) });
      } catch (err) { showToast(err.message, 5000); }
    };
    reader.onerror = () => showToast('Could not read the file');
    reader.readAsArrayBuffer(file);
  };
  const confirmImport = () => {
    if (!importPreview || !importPreview.valid.length) return;
    const stamp = Date.now();
    const items = importPreview.valid.map((r, i) => ({ id: `l${stamp}_${i}`, title: r.title, dept: r.dept, sev: r.sev, clause: r.clause, rc: r.rc, pa: r.pa, repeat: r.repeat, crossDept: r.crossDept }));
    writeSyncKey('ap_learns', [...items, ...getLearnings()], currentUser?.loginId);
    showToast(`${items.length} learning(s) imported`, 4000);
    setImportPreview(null);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      {/* Repository */}
      <Card title={`Learnings Repository (${learnings.length})`}>
        <div className="mb-2"><label className="form-label">Search</label><input placeholder="calibration, traceability..." value={search} onChange={e => setSearch(e.target.value)} /></div>
        <div className="space-y-2">
          {filtered.length === 0 ? (
            <div className="text-[11px] text-center py-3" style={{ color: 'var(--text3)' }}>No learnings yet</div>
          ) : filtered.map(l => (
            <div key={l.id} className={`finding-card ${l.sev}`}>
              <div className="flex justify-between items-start"><span className="font-bold text-xs">{l.title}</span><Badge type={SEV_BADGE[l.sev] || 'b-gray'}>{SEV_LABEL[l.sev] || l.sev}</Badge></div>
              <div className="text-[10px] mt-1" style={{ color: 'var(--text3)' }}>{l.dept || 'All'}</div>
              {l.clause ? <div className="text-[11px] mt-1" style={{ color: 'var(--text2)' }}><strong>Problem:</strong> {l.clause}</div> : null}
              <div className="text-[11px] mt-1" style={{ color: 'var(--text2)' }}><strong>RC:</strong> {l.rc}</div>
              <div className="text-[11px]" style={{ color: 'var(--text2)' }}><strong>PA:</strong> {l.pa}</div>
              <div className="flex gap-2 mt-2 items-center">
                {l.repeat && <Badge type="b-purple">Repeat</Badge>}
                {l.crossDept && <Badge type="b-blue">X-dept</Badge>}
                {role === 'admin' && <button className="btn btn-danger btn-icon btn-sm ml-auto" onClick={() => delLearning(l.id)}><Icon name="trash-2" /></button>}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Add form */}
      <Card title="Add New Learning">
        <div className="flex flex-col gap-2">
          <div><label className="form-label">Title *</label><input ref={titleInputRef} placeholder="Learning title..." value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="form-label">Dept</label><select value={form.dept} onChange={e => setForm(p => ({ ...p, dept: e.target.value }))}><option value="">{currentUser?.accessScope === 'businessUnit' ? 'Select department' : 'All'}</option>{deptOptions.map(d => <option key={d.code} value={d.code}>{d.name}</option>)}</select></div>
            <div><label className="form-label">Severity</label><select value={form.sev} onChange={e => setForm(p => ({ ...p, sev: e.target.value }))}><option value="critical">Critical</option><option value="major">Major</option><option value="minor">Minor</option><option value="obs">Observation</option></select></div>
          </div>
          <div><label className="form-label">Problem Description</label><textarea style={{ height: 52, resize: 'none' }} placeholder="What went wrong?" value={form.clause} onChange={e => setForm(p => ({ ...p, clause: e.target.value }))} /></div>
          <div><label className="form-label">Root Cause</label><textarea style={{ height: 52, resize: 'none' }} placeholder="Describe root cause..." value={form.rc} onChange={e => setForm(p => ({ ...p, rc: e.target.value }))} /></div>
          <div><label className="form-label">Preventive Action</label><textarea style={{ height: 52, resize: 'none' }} placeholder="What prevents recurrence?" value={form.pa} onChange={e => setForm(p => ({ ...p, pa: e.target.value }))} /></div>
          <div className="flex gap-4 flex-wrap">
            <label className="flex items-center gap-[5px] text-xs" style={{ cursor: 'pointer' }}><input type="checkbox" style={{ width: 'auto' }} checked={form.repeat} onChange={e => setForm(p => ({ ...p, repeat: e.target.checked }))} /> Repeat Issue</label>
            <label className="flex items-center gap-[5px] text-xs" style={{ cursor: 'pointer' }}><input type="checkbox" style={{ width: 'auto' }} checked={form.crossDept} onChange={e => setForm(p => ({ ...p, crossDept: e.target.checked }))} /> Cross-dept</label>
          </div>
          <button className="btn btn-brand w-full" onClick={addLearning}><Icon name="lightbulb" /> Save to Knowledge Base</button>
          <div className={`grid gap-2 ${canBulk ? 'grid-cols-3' : 'grid-cols-1'}`}>
            {canBulk && <button className="btn btn-ghost btn-sm" onClick={exportTemplate} title="Download the Excel file to fill in old learnings"><Icon name="download" /> Export Template</button>}
            <button className="btn btn-ghost btn-sm" onClick={exportExcel} title="Download the whole learning library"><Icon name="table" /> Export Excel</button>
            {canBulk && <button className="btn btn-ghost btn-sm" onClick={() => importInputRef.current && importInputRef.current.click()} title="Import many learnings from the template"><Icon name="upload" /> Bulk Import</button>}
          </div>
          <input ref={importInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onImportFile} />
        </div>
      </Card>

      {importPreview && (
        <div className="modal-bg" onClick={() => setImportPreview(null)}>
          <div className="modal-box" style={{ maxWidth: 640, width: '95vw', maxHeight: '88vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header"><span>Review learnings import</span><button className="btn btn-ghost btn-icon btn-sm" onClick={() => setImportPreview(null)}><Icon name="x" /></button></div>
            <div className="text-[11px] mb-3" style={{ color: 'var(--text3)' }}>{importPreview.name}: {importPreview.total} row(s) read</div>
            <div className="grid grid-cols-3 gap-2 mb-3">
              <div className="stat-card"><div className="stat-label">Will import</div><div className="stat-value" style={{ color: 'var(--green)' }}>{importPreview.valid.length}</div></div>
              <div className="stat-card"><div className="stat-label">Duplicates (skipped)</div><div className="stat-value" style={{ color: 'var(--text3)' }}>{importPreview.duplicates.length}</div></div>
              <div className="stat-card"><div className="stat-label">Need fixing</div><div className="stat-value" style={{ color: importPreview.invalid.length ? 'var(--red)' : 'var(--text3)' }}>{importPreview.invalid.length}</div></div>
            </div>
            {importPreview.invalid.length > 0 && (
              <div className="mb-3">
                <div className="text-[11px] font-bold mb-1" style={{ color: 'var(--red)' }}>Rows that will not be imported</div>
                <div className="text-[10px] space-y-1" style={{ maxHeight: 140, overflowY: 'auto' }}>
                  {importPreview.invalid.slice(0, 50).map(r => <div key={r.rowNo}>Row {r.rowNo}{r.title ? ` (${r.title.slice(0, 40)})` : ''}: {r.problems.join('; ')}</div>)}
                </div>
              </div>
            )}
            {importPreview.valid.length > 0 && (
              <div className="mb-3">
                <div className="text-[11px] font-bold mb-1">First learnings to import</div>
                <div className="text-[10px] space-y-1">
                  {importPreview.valid.slice(0, 5).map(r => <div key={r.rowNo}><strong>{r.title}</strong> · {r.dept || 'All'} · {SEV_LABEL[r.sev]}</div>)}
                  {importPreview.valid.length > 5 && <div style={{ color: 'var(--text3)' }}>and {importPreview.valid.length - 5} more</div>}
                </div>
              </div>
            )}
            <div className="flex gap-2">
              <button className="btn btn-ghost flex-1" onClick={() => setImportPreview(null)}>Cancel</button>
              <button className="btn btn-brand flex-1" disabled={!importPreview.valid.length} onClick={confirmImport}>Import {importPreview.valid.length} learning(s)</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
