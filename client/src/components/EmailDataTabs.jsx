import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { Card, Badge, Icon, ConfirmModal, EmptyState } from './UI';
import { showToast, genId } from '../utils/helpers';
import { apiFetch } from '../utils/api';
import { emailMasterWithUsers } from '../utils/emailMaster';

function deptCodeFromName(name, depts) {
  const clean = String(name || '').trim().replace(/\s+/g, ' ');
  if (!clean) return '';
  const existing = depts.find(d => d.name.toLowerCase() === clean.toLowerCase() || d.code.toLowerCase() === clean.toLowerCase());
  if (existing) return existing.code;
  let code = clean.toUpperCase().replace(/&/g, ' AND ').replace(/[^A-Z0-9]+/g, ' ').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 5);
  if (!code) code = 'DEPT';
  const used = new Set(depts.map(d => d.code));
  let base = code, n = 2;
  while (used.has(code)) { code = (base + n).slice(0, 6); n++; }
  return code;
}
function splitEmailList(value) {
  return String(value || '').split(/\|\||[;,]/).map(x => x.trim()).filter(x => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x));
}
function joinEmailList(value) { return splitEmailList(value).join(', '); }

// Email Master, Email Templates and Email Logs — used inside the Email Center.
// `tab` is one of 'emailmaster' | 'emailtemplates' | 'emaillogs'.
// ── Email Logs ──
const LOG_TYPE = {
  upcoming_reminder: ['Upcoming Reminder', 'b-blue', 'auto'],
  delayed: ['Delayed NC', 'b-amber', 'auto'],
  escalation_2: ['Escalation → HOD', 'b-red', 'auto'],
  escalation_3: ['Escalation → Management', 'b-purple', 'auto'],
  escalation: ['Escalation', 'b-red', 'auto'],
  audit_submission: ['Audit Report', 'b-green', 'audit'],
  capa_reminder: ['CAPA Reminder', 'b-amber', 'manual'],
  manager_summary: ['Manager Summary', 'b-gray', 'manual'],
  dept_report: ['Department Report', 'b-gray', 'manual'],
  monthly_summary: ['Monthly Summary', 'b-purple', 'audit'],
  test: ['Test', 'b-gray', 'test'],
};
const LOG_STATUS = { sent: 'b-green', failed: 'b-red', skipped: 'b-amber', throttled: 'b-gray' };
const LOG_FILTERS = [['all', 'All'], ['auto', 'Automatic reminders'], ['audit', 'Audit reports & summaries'], ['manual', 'Manual reminders'], ['test', 'Tests'], ['problem', 'Failed / skipped']];
const LOG_PAGE = 50;

export default function EmailDataTabs({ tab }) {
  const { getDepts, getUsers, getEmailMaster, getEmailTemplates, getEmailLogs, getRequiredCcEmails, writeSyncKey, currentUser, setPageAction } = useApp();
  const [emEdit, setEmEdit] = useState(null);
  const [emSearch, setEmSearch] = useState('');
  const [ccInput, setCcInput] = useState('');
  const [tplId, setTplId] = useState(null);
  const [tplDraft, setTplDraft] = useState(null);
  const [testEmail, setTestEmail] = useState('');
  const [sendingTest, setSendingTest] = useState(false);
  const [checkingSmtp, setCheckingSmtp] = useState(false);
  const [previewMail, setPreviewMail] = useState(null);
  const [logFilter, setLogFilter] = useState('all');
  const [logSearch, setLogSearch] = useState('');
  const [logLimit, setLogLimit] = useState(LOG_PAGE);
  const [confirmClear, setConfirmClear] = useState(false);
  const depts = getDepts();
  const emailMaster = emailMasterWithUsers(getEmailMaster(), getUsers(), depts);
  const templates = getEmailTemplates();
  const emailLogs = getEmailLogs();
  const ccList = getRequiredCcEmails();
  const canEdit = currentUser?.role === 'admin';

  useEffect(() => {
    setPageAction(() => () => { if (tab === 'emailmaster') setEmEdit(null); });
    return () => setPageAction(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const activeTpl = templates.find(t => t.id === tplId) || templates[0] || null;
  useEffect(() => {
    if (activeTpl && (!tplDraft || tplDraft.id !== activeTpl.id)) {
      setTplDraft({ id: activeTpl.id, type: activeTpl.type || String(activeTpl.id || '').replace(/^tpl_/, ''), name: activeTpl.name || '', subject: activeTpl.subject || '', body: activeTpl.body || '', active: activeTpl.active !== false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTpl?.id]);


  // ── Email Master ──
  const filteredEmailMaster = emailMaster.filter(r => {
    const q = emSearch.toLowerCase();
    if (!q) return true;
    return [r.spocName, r.email, r.department, r.deptCode, r.reportingName, r.reportingEmail, r.hodEmail, r.managementEmail].join(' ').toLowerCase().includes(q);
  });
  const saveEmailMaster = () => {
    const email = (emEdit?.email || '').trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showToast('Valid SPOC email required'); return; }
    const dept = depts.find(d => d.code === emEdit.deptCode) || {};
    const rows = getEmailMaster().slice();
    const id = emEdit?.id || genId('em');
    const existing = rows.find(x => x.id === id) || {};
    const obj = {
      id, spocName: (emEdit.spocName || '').trim(), email, deptCode: emEdit.deptCode, department: dept.name || emEdit.deptCode,
      reportingName: (emEdit.reportingName || '').trim(), reportingEmail: (emEdit.reportingEmail || '').trim(),
      hodEmail: (emEdit.hodEmail || '').trim(), managementEmail: (emEdit.managementEmail || '').trim(),
      status: emEdit.status || 'active', createdAt: existing.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const idx = rows.findIndex(x => x.id === id);
    if (idx >= 0) rows[idx] = obj; else rows.unshift(obj);
    writeSyncKey('ap_email_master', rows, currentUser?.loginId);
    setEmEdit(null);
    showToast('Email master saved');
  };
  const deleteEmailMaster = (id) => {
    writeSyncKey('ap_email_master', getEmailMaster().filter(x => x.id !== id), currentUser?.loginId);
    showToast('Deleted');
  };
  const toggleEmailMasterStatus = (record) => {
    const active = String(record.status || 'active').toLowerCase() === 'active';
    const nextStatus = active ? 'inactive' : 'active';
    writeSyncKey('ap_email_master', getEmailMaster().map(row => row.id === record.id ? { ...row, status: nextStatus, updatedAt: new Date().toISOString() } : row), currentUser?.loginId);
    showToast(`${record.spocName || record.email} ${active ? 'deactivated' : 'activated'} for automatic emails`);
  };
  const downloadEmailSample = () => {
    if (!window.XLSX) { showToast('Excel loading...'); return; }
    const ws = window.XLSX.utils.json_to_sheet([{ SPOCName: 'A. Gupta', EmailID: 'spoc@example.com', DepartmentName: 'Stores', ReportingToName: 'Manager', ReportingToEmail: 'manager@example.com', HODBUHEmail: 'hod@example.com', ManagementEmail: 'management@example.com', Status: 'Active' }]);
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'Email Master');
    window.XLSX.writeFile(wb, 'Email_Master_Sample.xlsx');
  };
  const importEmailMaster = (evt) => {
    const file = evt.target.files?.[0];
    if (!file) return;
    if (!window.XLSX) { showToast('Excel loading...'); return; }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = window.XLSX.read(e.target.result, { type: 'array' });
        const sheet = wb.Sheets['Email ID Database'] || wb.Sheets[wb.SheetNames[0]];
        const data = window.XLSX.utils.sheet_to_json(sheet);
        let imported = 0, updated = 0;
        const rows = getEmailMaster().slice();
        let deptRows = getDepts().slice();
        data.forEach(row => {
          const deptName = String(row.DepartmentName || row.Department || row.dept || row['Department Name'] || '').trim();
          if (!deptName) return;
          let dept = deptRows.find(d => d.name.toLowerCase() === deptName.toLowerCase() || d.code.toLowerCase() === deptName.toLowerCase());
          if (!dept) {
            dept = { id: genId('dept'), code: deptCodeFromName(deptName, deptRows), name: deptName, spoc: 'TBD', risk: 'Medium', freq: 2, lastAudit: '—' };
            deptRows = [...deptRows, dept];
          }
          const email = joinEmailList(row.EmailID || row.Email || row.email || row['Email Id'] || row['Email ID'] || '');
          const obj = {
            id: 'em_' + dept.code, spocName: String(row.SPOCName || row['SPOC Name'] || '').trim(), email,
            deptCode: dept.code, department: dept.name,
            reportingName: String(row.ReportingToName || row['Reporting To Name'] || row['Reporting To (Name)'] || '').trim(),
            reportingEmail: joinEmailList(row.ReportingToEmail || row['Reporting To Email'] || row['Reporting To (Email)'] || ''),
            hodEmail: joinEmailList(row.HODBUHEmail || row['HOD/BUH Email'] || row['HOD/BUH Mail'] || ''),
            managementEmail: joinEmailList(row.ManagementEmail || row['Management Email'] || ''),
            status: String(row.Status || 'Active').toLowerCase() === 'inactive' ? 'inactive' : 'active',
            createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
          };
          const idx = rows.findIndex(r => r.deptCode === dept.code);
          if (idx >= 0) { obj.id = rows[idx].id; obj.createdAt = rows[idx].createdAt || obj.createdAt; rows[idx] = { ...rows[idx], ...obj }; updated++; }
          else { rows.unshift(obj); imported++; }
        });
        writeSyncKey('ap_depts', deptRows, currentUser?.loginId);
        writeSyncKey('ap_email_master', rows, currentUser?.loginId);
        showToast(`Imported ${imported} email records, updated ${updated}`, 5000);
      } catch (err) {
        showToast('Import failed: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
    evt.target.value = '';
  };

  // ── CC Manager ──
  const addCcEmail = () => {
    const email = ccInput.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showToast('Enter a valid email address'); return; }
    if (ccList.some(e => e.toLowerCase() === email)) { showToast('Email already in CC list'); return; }
    writeSyncKey('ap_required_cc_emails', [...ccList, email], currentUser?.loginId);
    setCcInput('');
    showToast(email + ' added to CC');
  };
  const removeCcEmail = (idx) => {
    const removed = ccList[idx];
    writeSyncKey('ap_required_cc_emails', ccList.filter((_, i) => i !== idx), currentUser?.loginId);
    showToast('Removed ' + (removed || 'email') + ' from CC');
  };
  const checkSmtp = async () => {
    setCheckingSmtp(true);
    try {
      const r = await apiFetch('/api/email/verify', {});
      showToast(r.smtp ? 'SMTP connection OK' : 'SMTP not verified');
    } catch (err) {
      showToast('SMTP check failed: ' + err.message);
    }
    setCheckingSmtp(false);
  };

  // ── Email Templates ──
  const saveEmailTemplate = () => {
    if (!tplDraft) return;
    const rows = templates.map(t => t.id === tplDraft.id ? { ...t, name: tplDraft.name, subject: tplDraft.subject, body: tplDraft.body, active: tplDraft.active, updatedAt: new Date().toISOString() } : t);
    writeSyncKey('ap_email_templates', rows, currentUser?.loginId);
    showToast('Template saved');
  };
  const sendTestTemplate = async () => {
    if (!testEmail.trim()) { showToast('Enter a recipient email'); return; }
    if (!tplDraft) return;
    setSendingTest(true);
    try {
      await apiFetch('/api/email/template-test', { method: 'POST', body: JSON.stringify({ to: testEmail.trim(), type: tplDraft.type, subject: tplDraft.subject, body: tplDraft.body }) });
      showToast('Test email sent to ' + testEmail.trim());
    } catch (err) {
      showToast('Send failed: ' + err.message);
    }
    setSendingTest(false);
  };
  const previewTemplate = async () => {
    if (!tplDraft) return;
    try {
      const r = await apiFetch('/api/email/template-preview', { method: 'POST', body: JSON.stringify({ type: tplDraft.type, subject: tplDraft.subject, body: tplDraft.body }) });
      setPreviewMail(r);
    } catch (err) { showToast('Preview failed: ' + err.message); }
  };
  const restoreDefaultTemplate = async () => {
    if (!tplDraft) return;
    try {
      const r = await apiFetch('/api/email/template-defaults');
      const def = (r.templates || []).find(t => t.type === tplDraft.type);
      if (!def) { showToast('No built-in default for this template'); return; }
      setTplDraft(p => ({ ...p, subject: def.subject, body: def.body }));
      showToast('Default wording loaded. Click Save Template to keep it.');
    } catch (err) { showToast('Could not load the default: ' + err.message); }
  };

  // ── Email Logs ──
  const clearEmailLogs = () => {
    writeSyncKey('ap_email_logs', [], currentUser?.loginId);
    setConfirmClear(false);
    showToast('Email logs cleared');
  };
  const sortedLogs = emailLogs.slice().sort((a, b) => String(b.sentAt || '').localeCompare(String(a.sentAt || '')));
  const filteredLogs = sortedLogs.filter(l => {
    const kind = (LOG_TYPE[l.type] || [])[2] || 'manual';
    if (logFilter === 'problem' ? (l.status === 'sent') : (logFilter !== 'all' && kind !== logFilter)) return false;
    const q = logSearch.trim().toLowerCase();
    return !q || [l.to, l.cc, l.subject, l.dept, l.type, l.error].join(' ').toLowerCase().includes(q);
  });

  return (
    <>
      {tab === 'emailmaster' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <Card>
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs font-bold" style={{ color: 'var(--text3)' }}>Email Master ({filteredEmailMaster.length})</span>
              {canEdit && <div className="flex gap-2">
                <button className="btn btn-ghost btn-sm" onClick={downloadEmailSample}>Template</button>
                <button className="btn btn-primary btn-sm" onClick={() => document.getElementById('em-import-file').click()}>Import</button>
                <input type="file" id="em-import-file" accept=".csv,.xlsx" className="hidden" onChange={importEmailMaster} />
              </div>}
            </div>
            <input className="mb-2" placeholder="Search SPOC, department or email..." value={emSearch} onChange={e => setEmSearch(e.target.value)} />
            <div className="table-wrap">
              <table>
                <thead><tr><th>SPOC</th><th>Dept</th><th>Manager</th><th>Status</th>{canEdit && <th>Actions</th>}</tr></thead>
                <tbody>
                  {filteredEmailMaster.length === 0 ? (
                    <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text3)', padding: 12 }}>No email records</td></tr>
                  ) : filteredEmailMaster.map(r => (
                    <tr key={r.id}>
                      <td><div className="font-bold">{r.spocName}</div><div className="text-[10px]" style={{ color: 'var(--text3)' }}>{r.email}</div></td>
                      <td>{r.department || r.deptCode}</td>
                      <td><div>{r.reportingName}</div><div className="text-[10px]" style={{ color: 'var(--text3)' }}>{r.reportingEmail}</div></td>
                      <td><Badge type={r.derivedFromUsers ? 'b-blue' : String(r.status || 'active').toLowerCase() === 'active' ? 'b-green' : 'b-gray'}>{r.derivedFromUsers ? 'User account' : String(r.status || 'active').toLowerCase() === 'active' ? 'Active' : 'Inactive'}</Badge></td>
                      {canEdit && <td>{r.derivedFromUsers ? <span className="text-[10px]" style={{ color: 'var(--text3)' }}>Managed in Admin Panel</span> : <div className="flex gap-1">
                        <button className={`btn btn-sm ${String(r.status || 'active').toLowerCase() === 'active' ? 'btn-amber' : 'btn-brand'}`} onClick={() => toggleEmailMasterStatus(r)}>{String(r.status || 'active').toLowerCase() === 'active' ? 'Deactivate' : 'Activate'}</button>
                        <button className={`btn btn-sm ${emEdit?.id === r.id ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setEmEdit(r)}>Edit</button>
                        <button className="btn btn-danger btn-sm" onClick={() => deleteEmailMaster(r.id)}>Delete</button>
                      </div>}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <div className="space-y-3">
            <Card title={emEdit?.id ? 'Edit Email Record' : 'Add Email Record'}>
              {canEdit ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div><label className="form-label">SPOC Name</label><input value={emEdit?.spocName || ''} onChange={e => setEmEdit(p => ({ ...(p || {}), spocName: e.target.value }))} /></div>
                    <div><label className="form-label">Email ID</label><input value={emEdit?.email || ''} onChange={e => setEmEdit(p => ({ ...(p || {}), email: e.target.value }))} /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div><label className="form-label">Department</label>
                      <select value={emEdit?.deptCode || ''} onChange={e => setEmEdit(p => ({ ...(p || {}), deptCode: e.target.value }))}>
                        <option value="">Select...</option>
                        {depts.map(d => <option key={d.code} value={d.code}>{d.name}</option>)}
                      </select>
                    </div>
                    <div><label className="form-label">Status</label>
                      <select value={emEdit?.status || 'active'} onChange={e => setEmEdit(p => ({ ...(p || {}), status: e.target.value }))}>
                        <option value="active">Active</option><option value="inactive">Inactive</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div><label className="form-label">Reporting To Name</label><input value={emEdit?.reportingName || ''} onChange={e => setEmEdit(p => ({ ...(p || {}), reportingName: e.target.value }))} /></div>
                    <div><label className="form-label">Reporting To Email</label><input value={emEdit?.reportingEmail || ''} onChange={e => setEmEdit(p => ({ ...(p || {}), reportingEmail: e.target.value }))} /></div>
                  </div>
                  <div><label className="form-label">HOD/BUH Email</label><input value={emEdit?.hodEmail || ''} onChange={e => setEmEdit(p => ({ ...(p || {}), hodEmail: e.target.value }))} /></div>
                  <div><label className="form-label">Management Email</label><input value={emEdit?.managementEmail || ''} onChange={e => setEmEdit(p => ({ ...(p || {}), managementEmail: e.target.value }))} /></div>
                  <div className="flex gap-2">
                    <button className="btn btn-brand flex-1" onClick={saveEmailMaster}>Save Email Record</button>
                    <button className="btn btn-ghost" onClick={() => setEmEdit(null)}>Clear</button>
                  </div>
                </div>
              ) : <div className="text-xs" style={{ color: 'var(--text3)' }}>Managed by Master Admin.</div>}
            </Card>
            <Card title="Global CC Recipients (All Emails)">
              <div className="text-[11px] mb-2" style={{ color: 'var(--text3)' }}>These emails are automatically added to CC on every outgoing email.</div>
              <div className="flex flex-wrap gap-1 mb-2">
                {ccList.map((email, i) => (
                  <span key={i} className="badge b-blue flex items-center gap-1">
                    {email}
                    <button onClick={() => removeCcEmail(i)} title="Remove" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'inherit', display: 'inline-flex' }}><Icon name="x" className="w-3 h-3" /></button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input placeholder="Add new CC email..." value={ccInput} onChange={e => setCcInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && addCcEmail()} />
                <button className="btn btn-primary btn-sm" onClick={addCcEmail}>+ Add</button>
                <button className="btn btn-ghost btn-sm" onClick={checkSmtp} disabled={checkingSmtp}>{checkingSmtp ? 'Checking…' : 'Check SMTP'}</button>
              </div>
            </Card>
          </div>
        </div>
      )}

      {tab === 'emailtemplates' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <Card title="Email Templates">
            <div className="space-y-2">
              {templates.length === 0 ? <div className="text-xs" style={{ color: 'var(--text3)' }}>No templates configured.</div> : templates.map(t => (
                <div key={t.id} className={`finding-card ${activeTpl?.id === t.id ? 'minor' : ''}`} onClick={() => setTplId(t.id)}>
                  <div className="flex justify-between items-center"><span className="font-bold text-xs">{t.name}</span><Badge type={t.active !== false ? 'b-green' : 'b-gray'}>{t.active !== false ? 'Active' : 'Disabled'}</Badge></div>
                  <div className="text-[10px] mt-1" style={{ color: 'var(--text3)' }}>{t.type}</div>
                </div>
              ))}
            </div>
          </Card>
          <Card title="Edit Template">
            {tplDraft ? (
              <div className="space-y-2">
                <div><label className="form-label">Template Name</label><input value={tplDraft.name} onChange={e => setTplDraft(p => ({ ...p, name: e.target.value }))} /></div>
                <div><label className="form-label">Subject (used for test emails; reminders in a conversation always keep one fixed subject so Gmail / Outlook thread them)</label><input value={tplDraft.subject} onChange={e => setTplDraft(p => ({ ...p, subject: e.target.value }))} /></div>
                <div><label className="form-label">Body (HTML). The branded header, footer and plain-text copy are added automatically.</label><textarea style={{ height: 220, resize: 'vertical', fontFamily: 'monospace', fontSize: 11 }} value={tplDraft.body} onChange={e => setTplDraft(p => ({ ...p, body: e.target.value }))} /></div>
                <label className="flex items-center gap-2 text-xs" style={{ cursor: 'pointer' }}>
                  <input type="checkbox" style={{ width: 'auto' }} checked={tplDraft.active} onChange={e => setTplDraft(p => ({ ...p, active: e.target.checked }))} /> Active
                </label>
                <div className="text-[10px]" style={{ color: 'var(--text3)' }}>Variables: {'{{department_name}}, {{spoc_name}}, {{recipient_name}}, {{nc_count}}, {{nc_table}}, {{summary}}, {{button}}, {{audit_name}}, {{submitted_at}}, {{nc_number}}, {{target_date}}, {{delay_days}}, {{clause_name}}, {{reminder_count}}, {{max_days_delayed}}, {{due_phrase}}, {{repeat_days}}, {{history}}, {{escalation_level}}, {{escalation_label}}'}</div>
                {canEdit && (
                  <>
                    <div className="flex gap-2">
                      <button className="btn btn-brand flex-1" onClick={saveEmailTemplate}>Save Template</button>
                      <button className="btn btn-ghost" onClick={previewTemplate}><Icon name="eye" /> Preview</button>
                      <button className="btn btn-ghost" onClick={restoreDefaultTemplate} title="Load the built-in professional wording into the editor">Restore default</button>
                    </div>
                    <div className="flex gap-2 pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
                      <input placeholder="Send test to email..." value={testEmail} onChange={e => setTestEmail(e.target.value)} />
                      <button className="btn btn-ghost btn-sm" onClick={sendTestTemplate} disabled={sendingTest}>{sendingTest ? 'Sending…' : 'Send Test'}</button>
                    </div>
                  </>
                )}
              </div>
            ) : <div className="text-xs" style={{ color: 'var(--text3)' }}>No template selected.</div>}
          </Card>
        </div>
      )}

      {tab === 'emaillogs' && (
        <Card>
          <div className="flex justify-between items-center gap-2 flex-wrap mb-2">
            <span className="text-xs font-bold" style={{ color: 'var(--text3)' }}>Email Logs ({filteredLogs.length}{filteredLogs.length !== emailLogs.length ? ` of ${emailLogs.length}` : ''})</span>
            {canEdit && emailLogs.length > 0 && <button className="btn btn-ghost btn-sm" onClick={() => setConfirmClear(true)}>Clear Logs</button>}
          </div>
          <div className="flex gap-1 flex-wrap mb-2">
            {LOG_FILTERS.map(([id, label]) => (
              <button key={id} className={`btn btn-sm ${logFilter === id ? 'btn-brand' : 'btn-ghost'}`} onClick={() => { setLogFilter(id); setLogLimit(LOG_PAGE); }}>{label}</button>
            ))}
          </div>
          <input className="mb-2" placeholder="Search department, recipient, subject or error..." value={logSearch} onChange={e => { setLogSearch(e.target.value); setLogLimit(LOG_PAGE); }} />
          {filteredLogs.length === 0 ? (
            <EmptyState icon="inbox" title="No emails found" subtitle={emailLogs.length ? 'Nothing matches this filter.' : 'Emails sent by the portal will be listed here.'} />
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>When</th><th>Type</th><th>Dept</th><th>Reminder</th><th>To</th><th>CC</th><th>Subject</th><th>Status</th></tr></thead>
                <tbody>
                  {filteredLogs.slice(0, logLimit).map((l, i) => {
                    const [label, badge] = LOG_TYPE[l.type] || [l.type || '—', 'b-gray'];
                    return (
                      <tr key={l.id || i}>
                        <td className="text-[10px]" style={{ whiteSpace: 'nowrap' }}>{l.sentAt ? new Date(l.sentAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}</td>
                        <td><Badge type={badge}>{label}</Badge></td>
                        <td className="text-[10px]">{l.dept || '—'}</td>
                        <td className="text-[10px]" style={{ whiteSpace: 'nowrap' }}>{l.reminderNo ? `#${l.reminderNo}${l.maxDelay > 0 ? ` · ${l.maxDelay}d late` : ''}` : '—'}</td>
                        <td className="text-[10px]">{l.to || '—'}</td>
                        <td className="text-[10px]" style={{ color: 'var(--text3)', maxWidth: 220 }}>{l.cc || '—'}</td>
                        <td className="text-[10px]" style={{ maxWidth: 260 }}>{l.subject}</td>
                        <td><Badge type={LOG_STATUS[l.status] || 'b-gray'}>{l.status}</Badge>{l.error && <div className="text-[9px]" style={{ color: 'var(--red)' }}>{l.error}</div>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {filteredLogs.length > logLimit && (
            <div className="text-center mt-2"><button className="btn btn-ghost btn-sm" onClick={() => setLogLimit(n => n + LOG_PAGE)}>Show more ({filteredLogs.length - logLimit} remaining)</button></div>
          )}
          <ConfirmModal open={confirmClear} message="This permanently deletes the whole email log. Sent emails are not recalled. Continue?" onCancel={() => setConfirmClear(false)} onConfirm={clearEmailLogs} />
        </Card>
      )}

      {previewMail && (
        <div className="modal-bg" onClick={() => setPreviewMail(null)}>
          <div className="modal-box" style={{ maxWidth: 760, width: '95vw' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header"><span>Email Preview</span><button className="btn btn-ghost btn-icon btn-sm" onClick={() => setPreviewMail(null)}><Icon name="x" /></button></div>
            <div className="text-[11px] mb-2" style={{ color: 'var(--text3)' }}>Subject: <strong style={{ color: 'var(--text)' }}>{previewMail.subject}</strong> (sample data)</div>
            <iframe title="Email preview" sandbox="" srcDoc={previewMail.html} style={{ width: '100%', height: '65vh', border: '1px solid var(--border)', borderRadius: 8, background: '#fff' }} />
          </div>
        </div>
      )}
    </>
  );
}
