import React, { lazy, Suspense, useEffect, useState } from 'react';
import { useApp } from './context/AppContext';
import Sidebar from './components/Sidebar';
import Topbar from './components/Topbar';
import Login from './components/Login';
import { Toast } from './components/UI';
import { loadExcel, loadJsPdf, loadPdfJs } from './utils/externalLibraries';

// Each module is downloaded separately. Frequently used, permitted modules are
// prefetched just after data sync, so navigation stays instant without making the
// login screen wait for the whole application.
const PAGE_LOADERS = {
  dashboard: () => import('./pages/Dashboard'), analytics: () => import('./pages/Analytics'),
  findings: () => import('./pages/Findings'), capa: () => import('./pages/CAPA'),
  planning: () => import('./pages/Planning'), execution: () => import('./pages/Execution'),
  reports: () => import('./pages/Reports'), learnings: () => import('./pages/Learnings'),
  media: () => import('./pages/Media'), masterdata: () => import('./pages/MasterData'),
  emailcenter: () => import('./pages/EmailCenter'), adminpanel: () => import('./pages/AdminPanel'),
  mytasks: () => import('./pages/MyTasks'), managerpanel: () => import('./pages/ManagerPanel'),
  mastertracker: () => import('./pages/MasterTracker'), ocp: () => import('./pages/OcpManual'),
  importdata: () => import('./pages/ImportData'), profile: () => import('./pages/Profile'),
};
const Dashboard = lazy(PAGE_LOADERS.dashboard); const Analytics = lazy(PAGE_LOADERS.analytics);
const Findings = lazy(PAGE_LOADERS.findings); const CAPA = lazy(PAGE_LOADERS.capa);
const Planning = lazy(PAGE_LOADERS.planning); const Execution = lazy(PAGE_LOADERS.execution);
const Reports = lazy(PAGE_LOADERS.reports); const Learnings = lazy(PAGE_LOADERS.learnings);
const Media = lazy(PAGE_LOADERS.media); const MasterData = lazy(PAGE_LOADERS.masterdata);
const EmailCenter = lazy(PAGE_LOADERS.emailcenter); const AdminPanel = lazy(PAGE_LOADERS.adminpanel);
const MyTasks = lazy(PAGE_LOADERS.mytasks); const ManagerPanel = lazy(PAGE_LOADERS.managerpanel);
const MasterTracker = lazy(PAGE_LOADERS.mastertracker); const OcpManual = lazy(PAGE_LOADERS.ocp);
const ImportData = lazy(PAGE_LOADERS.importdata); const Profile = lazy(PAGE_LOADERS.profile);

export default function App() {
  const { currentUser, currentPage, canAccess, authChecked, syncStatus } = useApp();
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

  useEffect(() => {
    if (!currentUser || syncStatus !== 'synced') return undefined;
    const timer = window.setTimeout(() => {
      ['dashboard', 'analytics', 'findings', 'capa', 'reports', 'learnings', 'media', 'mytasks', 'managerpanel', 'ocp']
        .filter(page => page === 'ocp' || canAccess(page))
        .forEach(page => PAGE_LOADERS[page]().catch(() => {}));
    }, 100);
    return () => window.clearTimeout(timer);
  }, [currentUser, syncStatus, canAccess]);

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
