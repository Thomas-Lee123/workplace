import { useState } from 'react';
import { login, register, type User } from '../api';
import { useT } from '../i18n';

export default function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const { t } = useT();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    if (mode === 'register' && password !== confirmPassword) {
      setError(t('login.passwordMismatch'));
      setLoading(false);
      return;
    }

    try {
      const fn = mode === 'login' ? login : register;
      const res = await fn(email, password, name);
      localStorage.setItem('token', res.token);
      onLogin(res.user);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>{t('login.appName')}</h1>
        <p className="auth-subtitle">{t('login.appSubtitle')}</p>

        <div className="auth-tabs">
          <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>{t('login.signIn')}</button>
          <button className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>{t('login.signUp')}</button>
        </div>

        <form onSubmit={handleSubmit}>
          {mode === 'register' && (
            <input
              type="text"
              placeholder={t('login.name')}
              value={name}
              onChange={e => setName(e.target.value)}
              required
            />
          )}
          <input
            type="email"
            placeholder={t('login.email')}
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
          />
          <input
            type="password"
            placeholder={t('login.password')}
            value={password}
            onChange={e => setPassword(e.target.value)}
            minLength={8}
            required
          />
          {mode === 'register' && (
            <input
              type="password"
              placeholder={t('login.confirmPassword')}
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              minLength={8}
              required
            />
          )}

          {error && <div className="error">{error}</div>}

          <button type="submit" disabled={loading} className="btn btn-full">
            {loading ? '...' : mode === 'login' ? t('login.signIn') : t('login.signUp')}
          </button>
        </form>
      </div>
    </div>
  );
}
