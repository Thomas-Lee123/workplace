import { BrowserRouter, Routes, Route, Navigate, useNavigate, useParams, useLocation, useSearchParams } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { getMe, getTrips, createTrip, deleteTrip, type User, type Trip } from './api';
import { LanguageProvider, useT } from './i18n';
import Login from './pages/Login';
import TripDetail from './pages/TripDetail';
import AddItem from './pages/AddItem';
import ImportTrip from './pages/ImportTrip';
import AIGenerate from './pages/AIGenerate';
import './App.css';

function Sidebar({ user, onLogout, trips, onTripsChange, onOpenPanel }: {
  user: User;
  onLogout: () => void;
  trips: Trip[];
  onTripsChange: () => void;
  onOpenPanel: (mode: 'ai' | 'import') => void;
}) {
  const { t, lang, setLang } = useT();
  const navigate = useNavigate();
  const { id: activeId } = useParams<{ id?: string }>();
  const [showCreate, setShowCreate] = useState(false);
  const [showNewMenu, setShowNewMenu] = useState(false);

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const title = form.get('title') as string;
    const destination = form.get('destination') as string;
    const startDate = form.get('startDate') as string;
    const endDate = form.get('endDate') as string;
    if (!title || !destination || !startDate || !endDate) return;
    const trip = await createTrip({ title, destination, startDate, endDate });
    onTripsChange();
    setShowCreate(false);
    setShowNewMenu(false);
    navigate(`/trip/${trip.id}`);
  }

  async function handleDelete(id: string) {
    if (!confirm(t('sidebar.deleteConfirm'))) return;
    await deleteTrip(id);
    onTripsChange();
    if (activeId === id) navigate('/');
  }

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-avatar">{user.name.charAt(0)}</div>
        <div className="sidebar-user-info">
          <div className="sidebar-user-name">{user.name}</div>
          <div className="sidebar-user-email">{user.email}</div>
        </div>
      </div>

      <div className="sidebar-scroll">
        <div className="sidebar-section-label">{t('sidebar.trips')}</div>

        <div className="sidebar-trips">
          {trips.map(trip => (
            <div
              key={trip.id}
              className={`sidebar-trip ${activeId === trip.id ? 'active' : ''}`}
              onClick={() => navigate(`/trip/${trip.id}`)}
              onContextMenu={e => { e.preventDefault(); handleDelete(trip.id); }}
            >
              <span className="sidebar-trip-emoji">{trip.destination.slice(0, 2)}</span>
              <div className="sidebar-trip-body">
                <div className="sidebar-trip-title">{trip.title}</div>
                <div className="sidebar-trip-date">{trip.startDate.split('T')[0]} — {trip.endDate.split('T')[0]}</div>
              </div>
            </div>
          ))}
        </div>

        {showNewMenu ? (
          <div className="sidebar-create-form">
            <button className="sidebar-link" onClick={() => { setShowCreate(true); setShowNewMenu(false); }}>
              + {t('sidebar.createManually')}
            </button>
            <button className="sidebar-link" onClick={() => { setShowNewMenu(false); onOpenPanel('ai'); }}>
              {t('sidebar.aiGenerate')}
            </button>
            <button className="sidebar-link" onClick={() => { setShowNewMenu(false); onOpenPanel('import'); }}>
              {t('sidebar.importTrip')}
            </button>
            <button className="sidebar-btn-cancel" onClick={() => setShowNewMenu(false)}>{t('sidebar.cancel')}</button>
          </div>
        ) : showCreate ? (
          <form onSubmit={handleCreate} className="sidebar-create-form">
            <input name="title" placeholder={t('sidebar.tripName')} autoFocus className="sidebar-input" />
            <input name="destination" placeholder={t('sidebar.destination')} className="sidebar-input" />
            <div style={{ display: 'flex', gap: 8 }}>
              <input type="date" name="startDate" className="sidebar-input" style={{ flex: 1 }} />
              <input type="date" name="endDate" className="sidebar-input" style={{ flex: 1 }} />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button type="submit" className="sidebar-btn">{t('sidebar.create')}</button>
              <button type="button" className="sidebar-btn-cancel" onClick={() => setShowCreate(false)}>{t('sidebar.cancel')}</button>
            </div>
          </form>
        ) : (
          <button className="sidebar-new-btn" onClick={() => setShowNewMenu(true)}>{t('sidebar.newTrip')}</button>
        )}

      </div>

      <div className="sidebar-footer">
        <button onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')} className="sidebar-link">{lang === 'zh' ? 'English' : '中文'}</button>
        <button onClick={onLogout} className="sidebar-link">{t('sidebar.logout')}</button>
      </div>
    </div>
  );
}

function AppRoutes({ trips, onTripsChange }: { trips: Trip[]; onTripsChange: () => void }) {
  const { t } = useT();
  return (
    <div className="main">
      <Routes>
        <Route path="/" element={
          <div className="main-empty">
            <div className="main-empty-text">{t('sidebar.empty')}</div>
          </div>
        } />
        <Route path="/trip/:id" element={<TripDetail onTripsChange={onTripsChange} />} />
        <Route path="/trip/:id/add" element={<AddItem />} />
        <Route path="/trip/:id/import" element={<ImportTrip trips={trips} onTripsChange={onTripsChange} />} />
        <Route path="/import" element={<ImportTrip trips={trips} onTripsChange={onTripsChange} />} />
        <Route path="/ai" element={<AIGenerate />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}

function ToolsPanel() {
  const { t } = useT();
  const location = useLocation();

  const match = location.pathname.match(/^\/trip\/([^/]+)$/);
  const tripId = match ? match[1] : null;

  if (!tripId) return null;

  return (
    <div className="sidebar-right">
      <div className="sidebar-section-label">{t('sidebar.tools')}</div>
      <button className="sidebar-link" onClick={() => window.dispatchEvent(new CustomEvent('trip:export', { detail: 'xlsx' }))}>{t('tripDetail.exportXlsx')}</button>
      <button className="sidebar-link" onClick={() => window.dispatchEvent(new CustomEvent('trip:export', { detail: 'doc' }))}>{t('tripDetail.exportDoc')}</button>
    </div>
  );
}

function SlidePanel({ mode, onClose, trips, onTripsChange }: {
  mode: 'ai' | 'import';
  onClose: () => void;
  trips: Trip[];
  onTripsChange: () => void;
}) {
  const { t } = useT();
  return (
    <div className="slide-panel">
      <div className="slide-panel-header">
        <span>{mode === 'ai' ? t('sidebar.aiGenerate') : t('sidebar.importTrip')}</span>
        <button className="chat-panel-close" onClick={onClose}>x</button>
      </div>
      <div className="slide-panel-body">
        {mode === 'ai' ? (
          <AIGenerate onClose={onClose} />
        ) : (
          <ImportTrip trips={trips} onTripsChange={onTripsChange} onClose={onClose} />
        )}
      </div>
    </div>
  );
}

function AppContent() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [searchParams, setSearchParams] = useSearchParams();
  const panelMode = (searchParams.get('panel') as 'ai' | 'import') || null;

  function openPanel(mode: 'ai' | 'import') {
    setSearchParams(prev => { prev.set('panel', mode); return prev; });
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
      <Sidebar
        user={user}
        onLogout={handleLogout}
        trips={trips}
        onTripsChange={loadTrips}
        onOpenPanel={openPanel}
      />
      <AppRoutes trips={trips} onTripsChange={loadTrips} />
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
