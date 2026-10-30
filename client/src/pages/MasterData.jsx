import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { Card, Tabs, Badge, ConfirmModal, Icon, Pagination } from '../components/UI';
import { showToast, genId } from '../utils/helpers';

const CP_PAGE_SIZE = 15;

export default function MasterData() {
  const {
    getDepts, getAuditors, getCheckpoints, getRootCauses, writeSyncKey, currentUser, setPageAction,
  } = useApp();
  const [tab, setTab] = useState('depts');
  const [editItem, setEditItem] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [cpPage, setCpPage] = useState(1);

  const [rcEdit, setRcEdit] = useState(null); // null = add mode

  const depts = getDepts();
  const auditors = getAuditors();
  const cps = getCheckpoints();
  const rootCauses = getRootCauses();
  const canEdit = currentUser?.role === 'admin';

  useEffect(() => {
    setPageAction(() => () => {
      if (tab === 'depts') setEditItem({ name: '', code: '', spoc: '', risk: 'Medium', freq: 4 });
      else if (tab === 'auds') setEditItem({ name: '', empId: '', cert: '', spec: '', email: '', status: 'active' });
      else if (tab === 'cps') setEditItem({ text: '', clause: '', weight: 3, type: 'Yes/No', dept: '', tip: '', aiSuggestion: '' });
      else if (tab === 'rootcauses') setRcEdit(null);
    });
    return () => setPageAction(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // ── Depts / Auditors / Checkpoints (modal CRUD) ──
  const storageKeyFor = (t) => t === 'depts' ? 'ap_depts' : t === 'auds' ? 'ap_auds' : 'ap_cps';
  const listFor = (t) => t === 'depts' ? getDepts() : t === 'auds' ? getAuditors() : getCheckpoints();

  const handleSave = () => {
    if (!editItem) return;
    if (tab === 'depts' && (!editItem.name?.trim() || !editItem.code?.trim())) { showToast('Code and Name required'); return; }
    if (tab === 'cps' && !editItem.text?.trim()) { showToast('Question text required'); return; }
    if (tab === 'auds' && !editItem.name?.trim()) { showToast('Name required'); return; }
    const current = listFor(tab);
    const updated = editItem.id
      ? current.map(item => item.id === editItem.id ? { ...item, ...editItem } : item)
      : [...current, { ...editItem, id: genId(tab), ...(tab === 'auds' ? { auditsYTD: 0 } : {}), ...(tab === 'depts' ? { lastAudit: '—' } : {}) }];
    writeSyncKey(storageKeyFor(tab), updated, currentUser?.loginId);
    setEditItem(null);
    showToast('Record saved successfully');
  };

  const handleDelete = () => {
    const { type, id } = confirmDelete;
    const updated = listFor(type).filter(item => item.id !== id);
    writeSyncKey(storageKeyFor(type), updated, currentUser?.loginId);
    setConfirmDelete(null);
    showToast('Record deleted');
  };

  const cpTotalPages = Math.max(1, Math.ceil(cps.length / CP_PAGE_SIZE));
  const cpSafePage = Math.min(cpPage, cpTotalPages);
  const pagedCps = cps.slice((cpSafePage - 1) * CP_PAGE_SIZE, cpSafePage * CP_PAGE_SIZE);

  // ── Root Causes ──
  const saveRootCause = () => {
    const name = (rcEdit?.name || '').trim();
    if (!name) { showToast('Root cause name required'); return; }
    const rows = getRootCauses().slice();
    const id = rcEdit?.id || genId('rc');
    if (rows.some(r => r.id !== id && String(r.name || '').toLowerCase() === name.toLowerCase())) { showToast('Root cause already exists'); return; }
    const existing = rows.find(r => r.id === id) || {};
    const obj = { id, name, status: rcEdit?.status || 'active', createdAt: existing.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
    const idx = rows.findIndex(r => r.id === id);
    if (idx >= 0) rows[idx] = obj; else rows.unshift(obj);
    writeSyncKey('ap_root_causes', rows, currentUser?.loginId);
    setRcEdit(null);
    showToast('Root cause saved');
  };
  const deleteRootCause = (id) => {
    writeSyncKey('ap_root_causes', getRootCauses().filter(r => r.id !== id), currentUser?.loginId);
    setRcEdit(null);
    showToast('Root cause deleted');
  };


  return (
    <div className="space-y-3">
      <Tabs
        tabs={[
          { id: 'depts', label: 'Departments' },
          { id: 'cps', label: 'Internal Checkpoints' },
          { id: 'rootcauses', label: 'Root Causes' },
          { id: 'auds', label: 'Auditors' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'depts' && (
        <Card>
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-bold" style={{ color: 'var(--text3)' }}>Departments ({depts.length})</span>
            {canEdit && <button className="btn btn-brand btn-sm" onClick={() => setEditItem({ name: '', code: '', spoc: '', risk: 'Medium', freq: 4 })}><Icon name="plus" /> Add</button>}
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Code</th><th>Name</th><th>SPOC</th><th>Risk</th><th>Freq</th><th>Last Audit</th>{canEdit && <th>Actions</th>}</tr></thead>
              <tbody>
                {depts.map(d => (
                  <tr key={d.id}>
                    <td className="font-bold">{d.code}</td><td>{d.name}</td><td>{d.spoc || '—'}</td>
                    <td><Badge type={d.risk === 'High' ? 'b-red' : d.risk === 'Low' ? 'b-green' : 'b-amber'}>{d.risk || 'Medium'}</Badge></td>
                    <td>{d.freq || 4}/yr</td><td>{d.lastAudit || '—'}</td>
                    {canEdit && <td><div className="flex gap-1">
                      <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setEditItem(d)}><Icon name="pencil" /></button>
                      <button className="btn btn-danger btn-sm btn-icon" onClick={() => setConfirmDelete({ type: 'depts', id: d.id })}><Icon name="trash-2" /></button>
                    </div></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'cps' && (
        <Card>
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-bold" style={{ color: 'var(--text3)' }}>Checkpoints ({cps.length})</span>
            {canEdit && <button className="btn btn-brand btn-sm" onClick={() => setEditItem({ text: '', clause: '', weight: 3, type: 'Yes/No', dept: '', tip: '', aiSuggestion: '' })}><Icon name="plus" /> Add</button>}
          </div>
          {!canEdit && <div className="info-box mb-2"><Icon name="lock" /> Only Master Admin can add/edit/delete checkpoints.</div>}
          <div className="table-wrap">
            <table>
              <thead><tr><th>Question</th><th>Clause</th><th>Dept</th><th>Risk</th>{canEdit && <th>Actions</th>}</tr></thead>
              <tbody>
                {pagedCps.map(cp => (
                  <tr key={cp.id}>
                    <td className="max-w-[260px]" style={{ fontSize: 12 }}>{cp.text}</td>
                    <td><Badge type="b-blue">{cp.clause || '—'}</Badge></td>
                    <td>{cp.dept || 'All'}</td>
                    <td style={{ color: cp.weight >= 5 ? 'var(--red)' : cp.weight >= 4 ? 'var(--amber)' : 'var(--teal)', fontWeight: 800 }}>{cp.weight || 3}/5</td>
                    {canEdit && <td><div className="flex gap-1">
                      <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setEditItem(cp)}><Icon name="pencil" /></button>
                      <button className="btn btn-danger btn-sm btn-icon" onClick={() => setConfirmDelete({ type: 'cps', id: cp.id })}><Icon name="trash-2" /></button>
                    </div></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination total={cps.length} page={cpSafePage} pageSize={CP_PAGE_SIZE} onChange={setCpPage} />
          <div className="text-[11px] mt-1" style={{ color: 'var(--text3)' }}>{cps.length} checkpoint(s)</div>
        </Card>
      )}

      {tab === 'rootcauses' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <Card>
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs font-bold" style={{ color: 'var(--text3)' }}>Root Cause Library ({rootCauses.length})</span>
              {canEdit && <button className="btn btn-brand btn-sm" onClick={() => setRcEdit(null)}><Icon name="plus" /> Add</button>}
            </div>
            {!canEdit && <div className="info-box mb-2">Only Master Admin can add/edit/delete root cause names.</div>}
            <div className="table-wrap">
              <table>
                <thead><tr><th>Name</th><th>Status</th>{canEdit && <th>Actions</th>}</tr></thead>
                <tbody>
                  {rootCauses.length === 0 ? (
                    <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--text3)', padding: 12 }}>No root causes configured</td></tr>
                  ) : rootCauses.map(r => (
                    <tr key={r.id}>
                      <td className="font-bold">{r.name}</td>
                      <td><Badge type={r.status === 'active' ? 'b-green' : 'b-gray'}>{r.status === 'active' ? 'Active' : 'Inactive'}</Badge></td>
                      {canEdit && <td><div className="flex gap-1">
                        <button className={`btn btn-sm ${rcEdit?.id === r.id ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setRcEdit(r)}>Edit</button>
                        <button className="btn btn-danger btn-sm" onClick={() => deleteRootCause(r.id)}>Delete</button>
                      </div></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="text-[11px] mt-2" style={{ color: 'var(--text3)' }}>Deleting does not rewrite old findings; historical root cause text remains preserved.</div>
          </Card>
          <Card title={rcEdit?.id ? 'Edit Root Cause' : 'Add Root Cause'}>
            {canEdit ? (
              <div className="space-y-2">
                <div><label className="form-label">Root Cause Name</label><input value={rcEdit?.name || ''} onChange={e => setRcEdit(p => ({ ...(p || {}), name: e.target.value }))} placeholder="Example: Method (SOP)" /></div>
                <div><label className="form-label">Status</label>
                  <select value={rcEdit?.status || 'active'} onChange={e => setRcEdit(p => ({ ...(p || {}), status: e.target.value }))}>
                    <option value="active">Active</option><option value="inactive">Inactive</option>
                  </select>
                </div>
                <div className="flex gap-2">
                  <button className="btn btn-brand flex-1" onClick={saveRootCause}>Save Root Cause</button>
                  <button className="btn btn-ghost" onClick={() => setRcEdit(null)}>Clear</button>
                </div>
              </div>
            ) : <div className="text-xs" style={{ color: 'var(--text3)' }}>Root causes are managed by Master Admin.</div>}
          </Card>
        </div>
      )}

      {tab === 'auds' && (
        <Card>
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-bold" style={{ color: 'var(--text3)' }}>Auditors ({auditors.length})</span>
            {canEdit && <button className="btn btn-brand btn-sm" onClick={() => setEditItem({ name: '', empId: '', cert: '', spec: '', email: '', status: 'active' })}><Icon name="plus" /> Add</button>}
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Name</th><th>Emp ID</th><th>Cert</th><th>Spec</th><th>YTD</th><th>Status</th>{canEdit && <th>Actions</th>}</tr></thead>
              <tbody>
                {auditors.map(a => (
                  <tr key={a.id}>
                    <td className="font-bold">{a.name}</td><td>{a.empId || '—'}</td><td>{a.cert}</td><td>{a.spec}</td><td>{a.auditsYTD || 0}</td>
                    <td><Badge type={a.status === 'active' ? 'b-green' : 'b-gray'}>{a.status === 'active' ? 'Active' : 'Inactive'}</Badge></td>
                    {canEdit && <td><div className="flex gap-1">
                      <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setEditItem(a)}><Icon name="pencil" /></button>
                      <button className="btn btn-danger btn-sm btn-icon" onClick={() => setConfirmDelete({ type: 'auds', id: a.id })}><Icon name="trash-2" /></button>
                    </div></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}


      {/* Add/Edit modal for depts/auds/cps */}
      {editItem && (
        <div className="modal-bg" onClick={() => setEditItem(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span>{editItem.id ? 'Edit Entry' : 'Add Entry'}</span>
              <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setEditItem(null)}><Icon name="x" /></button>
            </div>
            {tab === 'depts' && (
              <>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div><label className="form-label">Department Name</label><input value={editItem.name} onChange={e => setEditItem(p => ({ ...p, name: e.target.value }))} /></div>
                  <div><label className="form-label">Code</label><input value={editItem.code} onChange={e => setEditItem(p => ({ ...p, code: e.target.value }))} /></div>
                </div>
                <div className="mb-2"><label className="form-label">SPOC</label><input value={editItem.spoc || ''} onChange={e => setEditItem(p => ({ ...p, spoc: e.target.value }))} /></div>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div><label className="form-label">Risk Level</label>
                    <select value={editItem.risk || 'Medium'} onChange={e => setEditItem(p => ({ ...p, risk: e.target.value }))}>
                      <option value="Low">Low</option><option value="Medium">Medium</option><option value="High">High</option>
                    </select>
                  </div>
                  <div><label className="form-label">Audit Frequency (per year)</label><input type="number" min={1} max={12} value={editItem.freq || 4} onChange={e => setEditItem(p => ({ ...p, freq: Number(e.target.value) || 1 }))} /></div>
                </div>
              </>
            )}
            {tab === 'auds' && (
              <>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div><label className="form-label">Auditor Name</label><input value={editItem.name} onChange={e => setEditItem(p => ({ ...p, name: e.target.value }))} /></div>
                  <div><label className="form-label">Emp ID</label><input value={editItem.empId || ''} onChange={e => setEditItem(p => ({ ...p, empId: e.target.value }))} /></div>
                </div>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div><label className="form-label">Certification</label><input value={editItem.cert || ''} onChange={e => setEditItem(p => ({ ...p, cert: e.target.value }))} /></div>
                  <div><label className="form-label">Specialization</label><input value={editItem.spec || ''} onChange={e => setEditItem(p => ({ ...p, spec: e.target.value }))} /></div>
                </div>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div><label className="form-label">Email</label><input value={editItem.email || ''} onChange={e => setEditItem(p => ({ ...p, email: e.target.value }))} /></div>
                  <div><label className="form-label">Status</label>
                    <select value={editItem.status || 'active'} onChange={e => setEditItem(p => ({ ...p, status: e.target.value }))}>
                      <option value="active">Active</option><option value="inactive">Inactive</option>
                    </select>
                  </div>
                </div>
              </>
            )}
            {tab === 'cps' && (
              <>
                <div className="mb-2"><label className="form-label">Checkpoint Text</label><textarea value={editItem.text} onChange={e => setEditItem(p => ({ ...p, text: e.target.value }))} style={{ height: 60, resize: 'none' }} /></div>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div><label className="form-label">Clause</label><input value={editItem.clause || ''} onChange={e => setEditItem(p => ({ ...p, clause: e.target.value }))} /></div>
                  <div><label className="form-label">Risk Weight (1-5)</label><input type="number" min={1} max={5} value={editItem.weight || 3} onChange={e => setEditItem(p => ({ ...p, weight: Number(e.target.value) || 3 }))} /></div>
                </div>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div><label className="form-label">Type</label>
                    <select value={editItem.type || 'Yes/No'} onChange={e => setEditItem(p => ({ ...p, type: e.target.value }))}>
                      <option value="Yes/No">Yes/No</option><option value="Text">Text</option>
                    </select>
                  </div>
                  <div><label className="form-label">Department Code (Leave empty for All)</label><input value={editItem.dept || ''} onChange={e => setEditItem(p => ({ ...p, dept: e.target.value }))} /></div>
                </div>
                <div className="mb-2"><label className="form-label">QMS Checklist Tip</label><input value={editItem.tip || ''} onChange={e => setEditItem(p => ({ ...p, tip: e.target.value }))} /></div>
                <div className="mb-3"><label className="form-label">AI Suggestion (optional)</label><input value={editItem.aiSuggestion || ''} onChange={e => setEditItem(p => ({ ...p, aiSuggestion: e.target.value }))} /></div>
              </>
            )}
            <div className="flex gap-2">
              <button className="btn btn-ghost flex-1" onClick={() => setEditItem(null)}>Cancel</button>
              <button className="btn btn-primary flex-1" onClick={handleSave}>Save</button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={!!confirmDelete}
        message="Delete this record? This cannot be undone."
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
