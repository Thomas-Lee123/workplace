import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { getMe, type User } from './api';
import Login from './pages/Login';
import Trips from './pages/Trips';
import TripDetail from './pages/TripDetail';
import AddItem from './pages/AddItem';
import ImportTrip from './pages/ImportTrip';
import AIGenerate from './pages/AIGenerate';
import './App.css';

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      getMe()
        .then(setUser)
        .catch(() => localStorage.removeItem('token'))
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  if (loading) {
    return <div className="loading">加载中...</div>;
  }

  if (!user) {
    return <Login onLogin={setUser} />;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Trips user={user} onLogout={() => { localStorage.removeItem('token'); setUser(null); }} />} />
        <Route path="/trip/:id" element={<TripDetail />} />
        <Route path="/trip/:id/add" element={<AddItem />} />
        <Route path="/trip/:id/import" element={<ImportTrip />} />
        <Route path="/import" element={<ImportTrip />} />
        <Route path="/ai" element={<AIGenerate />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
