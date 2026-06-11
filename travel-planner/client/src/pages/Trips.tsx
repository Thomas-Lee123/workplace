import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getTrips, createTrip, deleteTrip, type Trip, type User } from '../api';

const DEST_EMOJI: Record<string, string> = {
  上海: '🏙', 北京: '🏯', 成都: '🐼', 杭州: '🌊', 三亚: '🏖', 西安: '🏛',
  重庆: '🌆', 广州: '🏙', 深圳: '🏙', 南京: '🏛', 苏州: '🏯', 厦门: '🏖',
  青岛: '🌊', 大连: '🌊', 长沙: '🌆', 武汉: '🌆', 昆明: '🌸', 大理: '🏔',
  丽江: '🏔', 桂林: '🏞', 张家界: '🏔', 黄山: '⛰', 拉萨: '🏔', 哈尔滨: '❄',
  香港: '🌃', 澳门: '🏰', 台北: '🏙', 东京: '🗼', 大阪: '🏯', 首尔: '🇰🇷',
  曼谷: '🛕', 普吉: '🏝', 新加坡: '🏙', 巴厘: '🌴', 巴黎: '🗼', 伦敦: '🏰', 纽约: '🗽',
};

function pickEmoji(dest: string): string {
  if (!dest) return '📍';
  for (const [k, v] of Object.entries(DEST_EMOJI)) {
    if (dest.includes(k)) return v;
  }
  return '📍';
}

function formatDateRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  const opts: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric' };
  const weekday = (d: Date) => d.toLocaleDateString('zh-CN', { weekday: 'short' });
  const fmt = (d: Date) => d.toLocaleDateString('zh-CN', opts);
  if (s.getTime() === e.getTime()) return `${fmt(s)} (${weekday(s)})`;
  return `${fmt(s)} (${weekday(s)}) — ${fmt(e)} (${weekday(e)})`;
}

function dayLabel(diff: number): string {
  if (diff === 0) return '今天出发';
  if (diff === 1) return '明天出发';
  if (diff === 2) return '后天出发';
  if (diff > 2 && diff <= 7) return `${diff}天后出发`;
  if (diff < 0) return `${Math.abs(diff)}天前已结束`;
  return '';
}

export default function Trips({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const navigate = useNavigate();

  useEffect(() => { loadTrips(); }, []);

  async function loadTrips() {
    try { const data = await getTrips(); setTrips(data); } catch {}
  }

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const title = form.get('title') as string;
    const destination = form.get('destination') as string;
    const startDate = form.get('startDate') as string;
    const endDate = form.get('endDate') as string;
    if (!title || !destination || !startDate || !endDate) return;
    const trip = await createTrip({ title, destination, startDate, endDate });
    setTrips([trip, ...trips]);
    setShowCreate(false);
    navigate(`/trip/${trip.id}`);
  }

  async function handleDelete(id: string) {
    if (!confirm('确定删除这个行程吗？')) return;
    await deleteTrip(id);
    setTrips(trips.filter(t => t.id !== id));
  }

  function tripStats(trip: Trip) {
    const total = trip.days.reduce((n, d) => n + d.items.length, 0);
    const purchased = trip.days.reduce((n, d) => n + d.items.filter(i => i.status === 'purchased').length, 0);
    const sum = trip.days.reduce((n, d) => n + d.items.reduce((s, i) => s + (i.price || 0), 0), 0);
    return { total, purchased, sum };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <div className="ios-page">
      <div className="ios-container">
        {/* Header */}
        <header className="ios-header">
          <h1>我的行程</h1>
          <button className="ios-header-btn" onClick={() => setShowCreate(!showCreate)}>
            {showCreate ? '取消' : '新建'}
          </button>
        </header>

        {/* Inline create form */}
        {showCreate && (
          <div className="ios-create-card">
            <form onSubmit={handleCreate}>
              <input
                className="ios-input"
                name="title"
                placeholder="行程名称"
                required
                autoFocus
              />
              <input
                className="ios-input"
                name="destination"
                placeholder="目的地"
                required
              />
              <div className="ios-date-row">
                <input className="ios-input" type="date" name="startDate" required />
                <span className="ios-date-sep">至</span>
                <input className="ios-input" type="date" name="endDate" required />
              </div>
              <div className="ios-create-actions">
                <button type="button" className="ios-btn-cancel" onClick={() => setShowCreate(false)}>取消</button>
                <button type="submit" className="ios-btn-primary">创建行程</button>
              </div>
            </form>
          </div>
        )}

        {/* Trip list */}
        {trips.length === 0 && !showCreate ? (
          <div className="ios-empty">
            <div className="ios-empty-icon">🧳</div>
            <p className="ios-empty-title">还没有行程</p>
            <p className="ios-empty-sub">点击右上角「新建」开始规划你的旅行</p>
            <div className="ios-empty-actions">
              <button className="ios-empty-btn" onClick={() => navigate('/ai')}>
                <span>✨</span> AI 生成行程
              </button>
              <button className="ios-empty-btn" onClick={() => navigate('/import')}>
                <span>📥</span> 导入行程
              </button>
            </div>
          </div>
        ) : (
          <div className="ios-list">
            {trips.map(trip => {
              const stats = tripStats(trip);
              const startDiff = Math.ceil((new Date(trip.startDate).getTime() - today.getTime()) / 86400000);
              const label = dayLabel(startDiff);
              return (
                <div
                  key={trip.id}
                  className="ios-card"
                  onClick={() => navigate(`/trip/${trip.id}`)}
                  onContextMenu={e => { e.preventDefault(); handleDelete(trip.id); }}
                >
                  <div className="ios-card-emoji">{pickEmoji(trip.destination)}</div>
                  <div className="ios-card-body">
                    <div className="ios-card-top">
                      <h3 className="ios-card-title">{trip.title}</h3>
                      {label && (
                        <span className={`ios-badge ${startDiff < 0 ? 'ios-badge-past' : startDiff <= 3 ? 'ios-badge-soon' : ''}`}>
                          {label}
                        </span>
                      )}
                    </div>
                    <p className="ios-card-dest">{trip.destination}</p>
                    <p className="ios-card-date">{formatDateRange(trip.startDate, trip.endDate)}</p>
                    <div className="ios-card-meta">
                      <span>{trip.days.length}天</span>
                      <span className="ios-meta-sep">·</span>
                      <span>{stats.total}个项目</span>
                      {stats.purchased > 0 && (
                        <>
                          <span className="ios-meta-sep">·</span>
                          <span style={{ color: '#34c759' }}>已购{stats.purchased}</span>
                        </>
                      )}
                      {stats.sum > 0 && (
                        <>
                          <span className="ios-meta-sep">·</span>
                          <span style={{ color: '#ff3b30' }}>¥{stats.sum.toLocaleString()}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="ios-card-chevron">
                    <svg width="12" height="20" viewBox="0 0 12 20"><path d="M1 1l9 9-9 9" fill="none" stroke="#C7C7CC" strokeWidth="2" strokeLinecap="round"/></svg>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Quick actions */}
        {trips.length > 0 && (
          <div className="ios-quick-actions">
            <button onClick={() => navigate('/ai')}>
              <span>✨</span> AI 生成
            </button>
            <span className="ios-action-sep" />
            <button onClick={() => navigate('/import')}>
              <span>📥</span> 导入行程
            </button>
          </div>
        )}

        {/* Account row */}
        <div className="ios-account-row">
          <div className="ios-account-info">
            <div className="ios-avatar">{user.name.charAt(0)}</div>
            <span>{user.name}</span>
          </div>
          <button className="ios-btn-cancel" onClick={onLogout}>退出登录</button>
        </div>
      </div>
    </div>
  );
}
