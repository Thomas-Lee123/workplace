import { BrowserRouter, Routes, Route, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { getMe, getTrips, type User, type Trip } from './api';
import { LanguageProvider } from './i18n';
import Sidebar from './components/Sidebar';
import ToolsPanel from './components/ToolsPanel';
import SlidePanel from './components/SlidePanel';
import Login from './pages/Login';
import TripDetail from './pages/TripDetail';
import AddItem from './pages/AddItem';
import './App.css';

function AppRoutes() {
  return (
    <div className="main">
      <Routes>
        <Route path="/" element={<div className="main-empty"><div className="main-empty-text">选择行程或创建新行程</div></div>} />
        <Route path="/trip/:id" element={<TripDetail />} />
        <Route path="/trip/:id/add" element={<AddItem />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}

function AppContent() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [searchParams, setSearchParams] = useSearchParams();
  const panelMode = (searchParams.get('panel') as 'ai' | 'import') || null;
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const navigate = useNavigate();

  function openPanel(mode: 'ai' | 'import') {
    setSearchParams(prev => { prev.set('panel', mode); return prev; });
    setMobileSidebarOpen(false);
  }
  function closePanel() {
    setSearchParams(prev => { prev.delete('panel'); return prev; });
  }

  async function loadTrips() {
    try { const data = await getTrips(); setTrips(data); } catch {}
  }

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      getMe()
        .then(u => { setUser(u); return getTrips(); })
        .then(setTrips)
        .catch(() => localStorage.removeItem('token'))
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  // Close mobile sidebar on navigation
  useEffect(() => {
    const unlisten = () => setMobileSidebarOpen(false);
    return () => unlisten();
  }, [navigate]);

  function handleLogout() {
    localStorage.removeItem('token');
    setUser(null);
    setTrips([]);
  }

  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  if (!user) {
    return <Login onLogin={(u) => { setUser(u); loadTrips(); }} />;
  }

  return (
    <div className="layout">
      <div className="mobile-topbar">
        <button className="mobile-topbar-btn" onClick={() => setMobileSidebarOpen(true)} aria-label="Menu">
          &#9776;
        </button>
        <span className="mobile-topbar-title">一键旅行</span>
        <span style={{ width: 34, flexShrink: 0 }} />
      </div>

      <div
        className={`mobile-sidebar-overlay${mobileSidebarOpen ? ' active' : ''}`}
        onClick={() => setMobileSidebarOpen(false)}
      />

      <Sidebar
        user={user}
        onLogout={handleLogout}
        trips={trips}
        onTripsChange={loadTrips}
        onOpenPanel={openPanel}
        mobileOpen={mobileSidebarOpen}
      />
      <AppRoutes />
      {panelMode ? (
        <SlidePanel mode={panelMode} onClose={closePanel} trips={trips} onTripsChange={loadTrips} />
      ) : (
        <ToolsPanel />
      )}
    </div>
  );
}

function App() {
  return (
    <LanguageProvider>
      <BrowserRouter>
        <AppContent />
      </BrowserRouter>
    </LanguageProvider>
  );
}

export default App;
