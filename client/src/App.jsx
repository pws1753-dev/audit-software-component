import React, { lazy, Suspense, useEffect, useState } from 'react';
import { useApp } from './context/AppContext';
import Sidebar from './components/Sidebar';
import Topbar from './components/Topbar';
import Login from './components/Login';
import { Toast } from './components/UI';
import { loadExcel, loadJsPdf, loadPdfJs } from './utils/externalLibraries';

// Each module is downloaded only when opened. This keeps Excel/PDF/admin code out
// of the login and first-dashboard bundle.
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Analytics = lazy(() => import('./pages/Analytics'));
const Findings = lazy(() => import('./pages/Findings'));
const CAPA = lazy(() => import('./pages/CAPA'));
const Planning = lazy(() => import('./pages/Planning'));
const Execution = lazy(() => import('./pages/Execution'));
const Reports = lazy(() => import('./pages/Reports'));
const Learnings = lazy(() => import('./pages/Learnings'));
const Media = lazy(() => import('./pages/Media'));
const MasterData = lazy(() => import('./pages/MasterData'));
const EmailCenter = lazy(() => import('./pages/EmailCenter'));
const AdminPanel = lazy(() => import('./pages/AdminPanel'));
const MyTasks = lazy(() => import('./pages/MyTasks'));
const ManagerPanel = lazy(() => import('./pages/ManagerPanel'));
const MasterTracker = lazy(() => import('./pages/MasterTracker'));
const OcpManual = lazy(() => import('./pages/OcpManual'));
const ImportData = lazy(() => import('./pages/ImportData'));
const Profile = lazy(() => import('./pages/Profile'));

export default function App() {
  const { currentUser, currentPage, canAccess, authChecked } = useApp();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Date filters passed from Topbar to active views
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [appliedDate, setAppliedDate] = useState({ from: '', to: '' });

  useEffect(() => {
    const excelPages = new Set(['analytics', 'findings', 'capa', 'planning', 'reports', 'learnings', 'mastertracker', 'importdata', 'masterdata', 'emailcenter']);
    if (excelPages.has(currentPage)) loadExcel().catch(() => {});
    if (['analytics', 'reports', 'mastertracker'].includes(currentPage)) loadJsPdf().catch(() => {});
    if (currentPage === 'ocp') loadPdfJs().catch(() => {});
  }, [currentPage]);

  if (!authChecked) {
    return (
      <div className="flex items-center justify-center h-screen text-sm" style={{ color: 'var(--text3)' }}>
        Loading…
      </div>
    );
  }

  if (!currentUser) {
    return (
      <>
        <Login />
        <Toast />
      </>
    );
  }

  const renderActivePage = () => {
    if (!canAccess(currentPage) && currentPage !== 'profile') {
      return (
        <div className="flex flex-col items-center justify-center h-[50vh] text-center">
          <div className="text-lg font-bold" style={{ color: 'var(--red)' }}>Access Denied</div>
          <div className="text-xs mt-1" style={{ color: 'var(--text3)' }}>You do not have permission to view this compliance module.</div>
        </div>
      );
    }

    switch (currentPage) {
      case 'dashboard':     return <Dashboard dateFrom={appliedDate.from} dateTo={appliedDate.to} />;
      case 'analytics':     return <Analytics dateFrom={appliedDate.from} dateTo={appliedDate.to} />;
      case 'findings':      return <Findings dateFrom={appliedDate.from} dateTo={appliedDate.to} />;
      case 'capa':          return <CAPA dateFrom={appliedDate.from} dateTo={appliedDate.to} />;
      case 'planning':      return <Planning />;
      case 'execution':     return <Execution />;
      case 'reports':       return <Reports dateFrom={appliedDate.from} dateTo={appliedDate.to} />;
      case 'learnings':     return <Learnings />;
      case 'media':         return <Media />;
      case 'mastertracker': return <MasterTracker dateFrom={appliedDate.from} dateTo={appliedDate.to} />;
      case 'masterdata':    return <MasterData />;
      case 'emailcenter':   return <EmailCenter />;
      case 'adminpanel':    return <AdminPanel />;
      case 'mytasks':       return <MyTasks />;
      case 'managerpanel':  return <ManagerPanel />;
      case 'ocp':           return <OcpManual />;
      case 'importdata':    return <ImportData />;
      case 'profile':       return <Profile />;
      default:              return <Dashboard />;
    }
  };

  return (
    <div className="app-container">
      {/* Sidebar */}
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Main viewport */}
      <div className="main-viewport">
        {/* Topbar */}
        <Topbar
          onMenuClick={() => setSidebarOpen(true)}
          dateFrom={dateFrom}
          dateTo={dateTo}
          onDateFrom={setDateFrom}
          onDateTo={setDateTo}
          onApplyDate={() => setAppliedDate({ from: dateFrom, to: dateTo })}
          onClearDate={() => { setDateFrom(''); setDateTo(''); setAppliedDate({ from: '', to: '' }); }}
        />

        {/* Content Wrapper */}
        <main className="content-wrapper" id="content-container">
          <Suspense fallback={<div className="flex items-center justify-center py-16 text-sm" style={{ color: 'var(--text3)' }}>Loading module…</div>}>
            {renderActivePage()}
          </Suspense>
        </main>
      </div>

      <Toast />
    </div>
  );
}
