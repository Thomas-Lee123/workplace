import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getTrip, updateTrip, updateItem, updateItemStatus, deleteItem, analyzeItem, streamAIChat, aiApplyChanges, reorderItem, downloadExport, type Trip, type ItemAnalysis, type SSEEvent } from '../api';

const TYPE_ORDER: Record<string, number> = { traffic: 0, hotel: 1, attraction: 2, meal: 3, custom: 4 };

function sortItems(items: any[]): any[] {
  return [...items].sort((a, b) => {
    const oa = TYPE_ORDER[a.type] ?? 5;
    const ob = TYPE_ORDER[b.type] ?? 5;
    if (oa !== ob) return oa - ob;
    return a.sortOrder - b.sortOrder;
  });
}

const TYPE_LABELS: Record<string, string> = {
  hotel: '🏨 酒店',
  attraction: '🎫 景点',
  traffic: '🚄 交通',
  meal: '🍽 餐饮',
  custom: '📌 其他',
};

const STATUS_LABELS: Record<string, string> = {
  pending: '⬜ 待购',
  purchased: '✅ 已购',
  cancelled: '❌ 取消',
};

const SOURCE_LABELS: Record<string, string> = {
  ctrip: '携程',
  mafengwo: '马蜂窝',
  fliggy: '飞猪',
  meituan: '美团',
  qunar: '去哪儿',
  manual: '手动',
};

function buildSearchKeyword(dest: string, kw: string, type: string): string {
  // Use destination as primary keyword, append type-specific terms
  if (type === 'hotel') return `${dest} ${kw.includes('酒店') || kw.includes('民宿') ? kw : kw + '酒店'}`;
  if (type === 'attraction') return `${dest} ${kw.includes('景点') || kw.includes('门票') ? kw : kw + '景点'}`;
  if (type === 'traffic') return `${dest} 机票`; // traffic search is about flights/trains to dest
  return `${dest} ${kw}`;
}

interface SearchSite {
  key: string;
  name: string;
  types?: string[]; // only show for these item types; show for all if omitted
  url: (kw: string, type: string, dest: string, dates?: { start: string; end: string }) => string;
}

const COMPARE_SITES: SearchSite[] = [
  {
    key: 'ctrip',
    name: '携程',
    url: (kw, type, dest, dates) => {
      const destEnc = encodeURIComponent(dest);
      if (type === 'hotel') {
        const checkin = dates?.start || '';
        const checkout = dates?.end || '';
        const params = new URLSearchParams();
        params.set('cityName', dest);
        params.set('destName', dest);
        params.set('searchWord', kw);
        params.set('searchType', 'D');
        params.set('optionId', '1');
        if (checkin) params.set('checkin', checkin);
        if (checkout) params.set('checkout', checkout);
        params.set('crn', '1');
        params.set('curr', 'CNY');
        params.set('locale', 'zh-CN');
        return `https://hotels.ctrip.com/hotels/list?${params.toString()}`;
      }
      if (type === 'attraction') return `https://you.ctrip.com/search/#${encodeURIComponent(dest + '景点')}`;
      if (type === 'traffic') return `https://flights.ctrip.com/search?keyword=${destEnc}`;
      return `https://m.ctrip.com/webapp/hotel/`;
    },
  },
  { key: 'fliggy', name: '飞猪', url: (kw, type, dest) => {
    const q = encodeURIComponent(buildSearchKeyword(dest, kw, type));
    return `https://www.fliggy.com/ifi/search.htm?q=${q}`;
  }},
  { key: 'tongcheng', name: '同程', url: (kw, type, dest) => {
    const q = encodeURIComponent(buildSearchKeyword(dest, kw, type));
    if (type === 'traffic') return `https://www.ly.com/flights/search?keyword=${encodeURIComponent(dest)}`;
    if (type === 'attraction') return `https://www.ly.com/scenery/search?keyword=${encodeURIComponent(dest)}`;
    return `https://m.ly.com/hotel/search?keyword=${q}`;
  }},
  {
    key: '12306',
    name: '12306',
    types: ['traffic'],
    url: (_kw, _type, _dest) => `https://www.12306.cn/index/`,
  },
];

const TRIP_SEARCH_BUTTONS = [
  { label: '搜酒店', type: 'hotel', icon: '🏨', kw: '酒店' },
  { label: '搜景点', type: 'attraction', icon: '🎫', kw: '景点' },
  { label: '搜交通', type: 'traffic', icon: '🚄', kw: '机票' },
];

export default function TripDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [analyses, setAnalyses] = useState<Record<string, ItemAnalysis>>({});
  const [expandedAnalysis, setExpandedAnalysis] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'ai'; text: string }[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatting, setChatting] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const ctrlRef = useRef<AbortController | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [editingField, setEditingField] = useState<{ itemId: string; field: string } | null>(null);
  const [dragItemId, setDragItemId] = useState<string | null>(null);
  const [dragOverDayId, setDragOverDayId] = useState<string | null>(null);
  const [dragOverAfterId, setDragOverAfterId] = useState<string | null>(null);
  const dragItemRef = useRef<string | null>(null);
  const dragOverDayRef = useRef<string | null>(null);
  const dragOverAfterRef = useRef<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  async function handleExport(format: 'xlsx' | 'doc') {
    if (!id || exporting) return;
    setExporting(true);
    try {
      await downloadExport(id, format);
    } catch (err: any) {
      alert('导出失败：' + (err.message || '未知错误'));
    } finally {
      setExporting(false);
      setExportOpen(false);
    }
  }

  useEffect(() => {
    if (!id) return;
    getTrip(id).then(t => {
      setTrip(t);
      // Restore saved analyses from item meta
      const saved: Record<string, ItemAnalysis> = {};
      for (const day of t.days) {
        for (const item of day.items) {
          if (item.meta?.analysis) saved[item.id] = item.meta.analysis;
        }
      }
      if (Object.keys(saved).length > 0) setAnalyses(saved);
    }).finally(() => setLoading(false));
  }, [id]);

  async function toggleStatus(itemId: string, current: string) {
    const next = current === 'pending' ? 'purchased' : current === 'purchased' ? 'cancelled' : 'pending';
    await updateItemStatus(id!, itemId, next);
    setTrip(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        days: prev.days.map(d => ({
          ...d,
          items: d.items.map(i => i.id === itemId ? { ...i, status: next } : i),
        })),
      };
    });
  }

  function startEditingTitle() {
    setTitleDraft(trip?.title || '');
    setEditingTitle(true);
  }

  async function saveTitle() {
    const val = titleDraft.trim();
    if (!val || !trip) { setEditingTitle(false); return; }
    try {
      await updateTrip(trip.id, {
        title: val,
        destination: trip.destination,
        startDate: trip.startDate,
        endDate: trip.endDate,
      });
      setTrip(prev => prev ? { ...prev, title: val } : prev);
    } catch (err: any) {
      alert('保存失败：' + (err.message || '未知错误'));
    }
    setEditingTitle(false);
  }

  async function saveItemField(itemId: string, field: string, val: string) {
    if (!id) return;
    await updateItem(id, itemId, { [field]: val } as any);
    setTrip(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        days: prev.days.map(d => ({
          ...d,
          items: d.items.map(i => i.id === itemId ? { ...i, [field]: val } : i),
        })),
      };
    });
    setEditingField(null);
  }

  async function handlePasteLink(itemId: string, url: string) {
    if (!url.trim()) return;
    await updateItem(id!, itemId, { sourceUrl: url.trim() } as any);
    setTrip(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        days: prev.days.map(d => ({
          ...d,
          items: d.items.map(i => i.id === itemId ? { ...i, sourceUrl: url.trim() } : i),
        })),
      };
    });

    // AI analyze the link
    setAnalyzing(itemId);
    try {
      const analysis = await analyzeItem(url.trim(), id!);
      setAnalyses(prev => ({ ...prev, [itemId]: analysis }));
      // Auto-apply analyzed title, type, price, image to the item + persist analysis to meta
      const updates: any = {};
      if (analysis.title) updates.title = analysis.title;
      if (analysis.type) updates.type = analysis.type;
      if (analysis.price != null) updates.price = analysis.price;
      if (analysis.imageUrl) updates.imageUrl = analysis.imageUrl;
      updates.meta = { analysis };
      await updateItem(id!, itemId, updates);
      setTrip(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          days: prev.days.map(d => ({
            ...d,
            items: d.items.map(i => i.id === itemId ? { ...i, ...updates } : i),
          })),
        };
      });
    } catch {
      // silently fail, user still saved the link
    } finally {
      setAnalyzing(null);
    }
  }

  async function handleDelete(itemId: string) {
    if (!confirm('确定删除此项目吗？')) return;
    await deleteItem(id!, itemId);
    setTrip(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        days: prev.days.map(d => ({
          ...d,
          items: d.items.filter(i => i.id !== itemId),
        })),
      };
    });
  }

  function handleDragStart(e: React.DragEvent, itemId: string) {
    dragItemRef.current = itemId;
    setDragItemId(itemId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', itemId);
  }

  function handleDragEnd(_e: React.DragEvent) {
    dragItemRef.current = null;
    dragOverDayRef.current = null;
    dragOverAfterRef.current = null;
    setDragItemId(null);
    setDragOverDayId(null);
    setDragOverAfterId(null);
  }

  function handleItemDragOver(e: React.DragEvent, dayId: string, itemId: string, sortedItems: any[]) {
    e.preventDefault();
    e.stopPropagation();
    if (!dragItemRef.current) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    let afterId: string | null;
    if (e.clientY < mid) {
      const idx = sortedItems.findIndex(i => i.id === itemId);
      afterId = idx > 0 ? sortedItems[idx - 1].id : null;
    } else {
      afterId = itemId;
    }
    if (dragOverDayRef.current !== dayId || dragOverAfterRef.current !== afterId) {
      dragOverDayRef.current = dayId;
      dragOverAfterRef.current = afterId;
      setDragOverDayId(dayId);
      setDragOverAfterId(afterId);
    }
  }

  function handleDayDragOver(e: React.DragEvent, dayId: string) {
    e.preventDefault();
    if (!dragItemRef.current) return;
    if (dragOverDayRef.current !== dayId || dragOverAfterRef.current !== null) {
      dragOverDayRef.current = dayId;
      dragOverAfterRef.current = null;
      setDragOverDayId(dayId);
      setDragOverAfterId(null);
    }
  }

  async function handleDrop(e: React.DragEvent, targetDayId: string) {
    e.preventDefault();
    const itemId = dragItemRef.current;
    const afterId = dragOverAfterRef.current;
    dragItemRef.current = null;
    dragOverDayRef.current = null;
    dragOverAfterRef.current = null;
    setDragItemId(null);
    setDragOverDayId(null);
    setDragOverAfterId(null);

    if (!itemId || !trip || itemId === afterId) return;

    let draggedItem: any = null;
    let sourceDayId = '';
    for (const day of trip.days) {
      const found = day.items.find(i => i.id === itemId);
      if (found) { draggedItem = found; sourceDayId = day.id; break; }
    }
    if (!draggedItem) return;

    // Already in the right position?
    if (sourceDayId === targetDayId && afterId === null) {
      // Check if it's already first
      const sorted = sortItems(trip.days.find(d => d.id === targetDayId)!.items.filter(i => i.id !== itemId));
      if (sorted.length === 0) return;
    }

    // Calculate target sortOrder
    const targetDay = trip.days.find(d => d.id === targetDayId)!;
    const otherItems = sortItems(targetDay.items.filter(i => i.id !== itemId));
    let targetSortOrder: number;
    if (afterId === null) {
      targetSortOrder = otherItems.length > 0 ? otherItems[0].sortOrder - 1 : 0;
    } else {
      const afterIdx = otherItems.findIndex(i => i.id === afterId);
      if (afterIdx === -1) return;
      if (afterIdx === otherItems.length - 1) {
        targetSortOrder = otherItems[afterIdx].sortOrder + 1;
      } else {
        targetSortOrder = (otherItems[afterIdx].sortOrder + otherItems[afterIdx + 1].sortOrder) / 2;
      }
    }

    try {
      await reorderItem(trip.id, itemId, targetSortOrder, targetDayId !== sourceDayId ? targetDayId : undefined);
      // Update local state optimistically
      setTrip(prev => {
        if (!prev) return prev;
        const movedItem = { ...draggedItem, sortOrder: targetSortOrder };
        return {
          ...prev,
          days: prev.days.map(d => {
            if (d.id === sourceDayId && d.id === targetDayId) {
              return { ...d, items: d.items.map(i => i.id === itemId ? movedItem : i) };
            }
            if (d.id === sourceDayId) {
              return { ...d, items: d.items.filter(i => i.id !== itemId) };
            }
            if (d.id === targetDayId) {
              return { ...d, items: [...d.items, movedItem] };
            }
            return d;
          }),
        };
      });
    } catch (err: any) {
      alert('移动失败：' + (err.message || '未知错误'));
      getTrip(trip.id).then(setTrip);
    }
  }

  async function handleChat() {
    if (!chatInput.trim() || chatting || !trip) return;
    const msg = chatInput.trim();
    setChatInput('');
    setChatMessages(prev => [...prev, { role: 'user', text: msg }]);
    setChatting(true);

    let fullReply = '';
    ctrlRef.current = streamAIChat(
      trip.id,
      msg,
      (e: SSEEvent) => {
        if (e.content) {
          fullReply += e.content;
          setChatMessages(prev => {
            const copy = [...prev];
            const last = copy[copy.length - 1];
            if (last && last.role === 'ai') {
              last.text = fullReply;
            } else {
              copy.push({ role: 'ai', text: fullReply });
            }
            return copy;
          });
        } else if (e.error) {
          setChatMessages(prev => [...prev, { role: 'ai', text: '抱歉，出错了：' + e.error }]);
        } else if (e.reply) {
          setChatMessages(prev => [...prev, { role: 'ai', text: e.reply || '' }]);
        }
      },
      async (tripData, changes) => {
        try {
          const updated = await aiApplyChanges(trip.id, tripData);
          setTrip(updated);
          setChatMessages(prev => [...prev, { role: 'ai', text: (changes || '已应用修改') + '\n\n行程已更新，请查看左侧。' }]);
        } catch (err: any) {
          setChatMessages(prev => [...prev, { role: 'ai', text: '应用修改失败：' + err.message }]);
        } finally {
          setChatting(false);
        }
      },
      (err: Error) => {
        setChatMessages(prev => [...prev, { role: 'ai', text: '抱歉，出错了：' + err.message }]);
        setChatting(false);
      },
    );
  }

  function toggleChat() {
    if (!chatOpen) {
      setChatOpen(true);
      if (chatMessages.length === 0 && trip) {
        const days = trip.days.map(d =>
          `${d.label} (${new Date(d.date).toLocaleDateString('zh-CN')}): ` +
          d.items.map(i => `${i.title}(${i.type})`).join('、')
        ).join('\n');
        setChatMessages([{
          role: 'ai',
          text: `你好！我是你的旅行助手。我看到你的行程「${trip.title}」已有以下安排：\n\n${days}\n\n有什么需要修改的吗？比如调整顺序、更换酒店、增加景点等。`,
        }]);
      }
    } else {
      ctrlRef.current?.abort();
      setChatOpen(false);
    }
  }

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [chatMessages]);

  if (loading) return <div className="loading">加载中...</div>;
  if (!trip) return <div className="loading">行程不存在</div>;

  const totalPrice = trip.days.reduce((n, d) => n + d.items.reduce((s, i) => s + (i.price || 0), 0), 0);
  const pending = trip.days.reduce((n, d) => n + d.items.filter(i => i.status === 'pending').length, 0);
  const purchased = trip.days.reduce((n, d) => n + d.items.filter(i => i.status === 'purchased').length, 0);

  const tripDates = { start: trip.startDate.split('T')[0], end: trip.endDate.split('T')[0] };

  return (
    <div className="page">
      <header className="header">
        <button className="btn-sm" onClick={() => navigate('/')}>← 返回</button>
        {editingTitle ? (
          <>
            <input
              value={titleDraft}
              onChange={e => setTitleDraft(e.target.value)}
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') setEditingTitle(false); }}
              style={{ fontSize: 18, fontWeight: 700, padding: '4px 8px', flex: 1 }}
            />
            <button className="btn-primary btn-sm" onClick={saveTitle}>保存</button>
            <button className="btn-sm" onClick={() => setEditingTitle(false)}>取消</button>
          </>
        ) : (
          <>
            <h2 style={{ flex: 1 }}>{trip.title}</h2>
            <button className="btn-sm" onClick={startEditingTitle} style={{ fontSize: 12 }}>✏️ 编辑</button>
          </>
        )}
        <div style={{ position: 'relative' }}>
          <button className="btn-sm" onClick={() => setExportOpen(!exportOpen)} disabled={exporting} style={{ background: '#52c41a', color: '#fff', border: 'none' }}>
            {exporting ? '导出中...' : '📥 导出'}
          </button>
          {exportOpen && (
            <div style={{
              position: 'absolute', top: '100%', right: 0, marginTop: 4,
              background: '#fff', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,.15)',
              zIndex: 100, overflow: 'hidden', minWidth: 140,
            }}>
              <div
                onClick={() => handleExport('xlsx')}
                style={{ padding: '10px 14px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid #f0f0f0' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#f5f5f5'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = '#fff'}
              >
                📊 导出 Excel
              </div>
              <div
                onClick={() => handleExport('doc')}
                style={{ padding: '10px 14px', cursor: 'pointer', fontSize: 13 }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#f5f5f5'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = '#fff'}
              >
                📄 导出 Word
              </div>
            </div>
          )}
        </div>
        <button className="btn-primary btn-sm" onClick={toggleChat} style={{ background: chatOpen ? '#ff4d4f' : '#722ed1' }}>
          {chatOpen ? '关闭 AI' : 'AI 助手'}
        </button>
      </header>

      <div style={{ display: 'flex', flex: 1 }}>
        <div className="container" style={{ flex: 1 }}>
        <div className="trip-summary">
          <span>{trip.destination}</span>
          <span>{new Date(trip.startDate).toLocaleDateString('zh-CN')} — {new Date(trip.endDate).toLocaleDateString('zh-CN')}</span>
          <span>预算 ¥{totalPrice.toLocaleString()}</span>
          <span>待购 {pending} · 已购 {purchased}</span>
        </div>

        {/* Trip-level quick search */}
        <div style={{
          display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center',
          padding: '10px 0', marginBottom: 4,
        }}>
          <span style={{ fontSize: 13, color: '#999', marginRight: 4 }}>快捷搜索：</span>
          {TRIP_SEARCH_BUTTONS.map(b => (
            <div key={b.type} style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: '#666', whiteSpace: 'nowrap' }}>{b.icon} {b.label}</span>
              {COMPARE_SITES.filter(s => !s.types || s.types.includes(b.type)).map(s => (
                <a
                  key={s.key}
                  href={s.url(b.kw, b.type, trip.destination, tripDates)}
                  target="_blank" rel="noopener noreferrer"
                  style={{
                    fontSize: 11, padding: '2px 8px', borderRadius: 4,
                    background: s.key === 'ctrip' ? '#1677ff' : s.key === 'fliggy' ? '#ff6b00' : s.key === 'tongcheng' ? '#ffc53d' : '#2b6cb0',
                    color: '#fff', textDecoration: 'none', whiteSpace: 'nowrap',
                  }}
                >
                  {s.name}
                </a>
              ))}
            </div>
          ))}
        </div>

        {trip.days.map(day => {
          const sorted = sortItems(day.items);
          return (
            <div key={day.id} className="day-section">
              <div className="day-header">
                <span className="day-label">{day.label}</span>
                <span className="day-date">{new Date(day.date).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })}</span>
                <button className="btn-primary btn-sm" style={{ marginLeft: 'auto' }} onClick={() => navigate(`/trip/${id}/add?dayId=${day.id}`)}>+ 添加</button>
              </div>

              <div
                className="item-list"
                onDragOver={(e) => handleDayDragOver(e, day.id)}
                onDrop={(e) => handleDrop(e, day.id)}
              >
                {sorted.length === 0 ? (
                  <div className="day-empty" style={{ padding: dragOverDayId === day.id ? '20px 0' : undefined }}>
                    {dragOverDayId === day.id ? '释放到此处' : '拖拽项目到这里'}
                  </div>
                ) : (
                  <>
                    {dragOverDayId === day.id && dragOverAfterId === null && (
                      <div style={{
                        height: 4, background: '#1677ff', borderRadius: 2,
                        margin: '6px 0', transition: 'margin 0.15s',
                      }} />
                    )}
                    {sorted.map((item) => (
                      <div key={item.id} className="item-list-item" style={{ position: 'relative' }}>
                        <div
                          className={`item-card status-${item.status}`}
                          draggable
                          onDragStart={(e) => handleDragStart(e, item.id)}
                          onDragEnd={handleDragEnd}
                          onDragOver={(e) => handleItemDragOver(e, day.id, item.id, sorted)}
                          style={{
                            cursor: dragItemId ? 'grabbing' : 'grab',
                            opacity: dragItemId === item.id ? 0.5 : 1,
                            transform: dragItemId === item.id ? 'scale(0.95)' : 'scale(1)',
                            transition: 'opacity 0.15s, transform 0.15s',
                            willChange: dragItemId === item.id ? 'transform, opacity' : 'auto',
                          }}
                        >
                          {item.imageUrl && (
                            <img src={item.imageUrl} alt={item.title} className="item-img" />
                          )}
                          <div className="item-body">
                            <div className="item-type">{TYPE_LABELS[item.type] || item.type}</div>
                            {editingField?.itemId === item.id && editingField?.field === 'title' ? (
                              <input
                                defaultValue={item.title}
                                autoFocus
                                onBlur={e => saveItemField(item.id, 'title', e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') saveItemField(item.id, 'title', e.currentTarget.value); if (e.key === 'Escape') setEditingField(null); }}
                                style={{ fontSize: 15, fontWeight: 600, padding: '2px 6px', width: '100%', marginBottom: 2 }}
                              />
                            ) : (
                              <h4 className="item-title" onClick={() => setEditingField({ itemId: item.id, field: 'title' })} style={{ cursor: 'pointer' }} title="点击编辑">
                                {item.title}
                              </h4>
                            )}
                            {editingField?.itemId === item.id && editingField?.field === 'subtitle' ? (
                            <input
                              defaultValue={item.subtitle}
                              autoFocus
                              placeholder="添加副标题..."
                              onBlur={e => saveItemField(item.id, 'subtitle', e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') saveItemField(item.id, 'subtitle', e.currentTarget.value); if (e.key === 'Escape') setEditingField(null); }}
                              style={{ fontSize: 12, padding: '2px 6px', width: '100%', marginBottom: 4 }}
                            />
                          ) : (
                            <p className="item-subtitle" onClick={() => setEditingField({ itemId: item.id, field: 'subtitle' })} style={{ cursor: 'pointer' }} title="点击编辑">
                              {item.subtitle || '+ 添加副标题'}
                            </p>
                          )}
                            <div className="item-info">
                              {item.price && <span className="item-price">¥{item.price.toLocaleString()}</span>}
                              <span className="item-source">{SOURCE_LABELS[item.source] || item.source}</span>
                              <button
                                className={`btn-status ${item.status}`}
                                onClick={() => toggleStatus(item.id, item.status)}
                              >
                                {STATUS_LABELS[item.status]}
                              </button>
                            </div>

                            <div className="item-actions">
                              {item.sourceUrl ? (
                                <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" className="btn-primary btn-sm">
                                  去源平台购买 →
                                </a>
                              ) : (
                                <a
                                  href={COMPARE_SITES[0].url(item.title, item.type, trip.destination, tripDates)}
                                  target="_blank" rel="noopener noreferrer"
                                  className="btn-primary btn-sm"
                                  style={{ background: '#fa8c16' }}
                                >
                                  在携程搜索 →
                                </a>
                              )}
                              <div className="compare-links">
                                {COMPARE_SITES.filter(s => !s.types || s.types.includes(item.type)).map(s => (
                                  <a key={s.key} href={s.url(item.title, item.type, trip.destination, tripDates)} target="_blank" rel="noopener noreferrer">
                                    {s.name}
                                  </a>
                                ))}
                              </div>
                              <div style={{ marginTop: 6 }}>
                                <input
                                  placeholder={item.sourceUrl ? item.sourceUrl : '粘贴链接记录（回车保存）'}
                                  defaultValue=""
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') {
                                      handlePasteLink(item.id, (e.target as HTMLInputElement).value);
                                      (e.target as HTMLInputElement).value = '';
                                    }
                                  }}
                                  style={{ fontSize: 12, padding: '4px 8px', flex: 1 }}
                                />
                              </div>
                              {analyzing === item.id && (
                                <div style={{ marginTop: 8, fontSize: 13, color: '#1677ff', display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <div className="spinner" /> AI 正在分析...
                                </div>
                              )}
                              {analyses[item.id] && (
                                <div style={{ marginTop: 8, background: '#f6ffed', borderRadius: 8, fontSize: 13, overflow: 'hidden' }}>
                                  <div
                                    onClick={() => setExpandedAnalysis(expandedAnalysis === item.id ? null : item.id)}
                                    style={{
                                      padding: '8px 10px', cursor: 'pointer',
                                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                      userSelect: 'none',
                                    }}
                                  >
                                    <span style={{ color: '#52c41a', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                                      🤖 AI 已分析
                                      {analyses[item.id].title && <span style={{ color: '#333' }}> · {analyses[item.id].title}</span>}
                                      {(() => { const a = analyses[item.id]; if (!a || a.price == null) return null; return <span style={{ color: '#ff4d4f' }}> · ¥{a.price.toLocaleString()}</span>; })()}
                                    </span>
                                    <span style={{ fontSize: 11, color: '#999', marginLeft: 8, flexShrink: 0 }}>{expandedAnalysis === item.id ? '收起 ▲' : '详情 ▼'}</span>
                                  </div>
                                  {expandedAnalysis === item.id && (
                                    <div style={{ padding: '0 10px 10px', borderTop: '1px solid #d9f7be' }}>
                                      {analyses[item.id].pros.length > 0 && (
                                        <div style={{ marginBottom: 4, marginTop: 8 }}>
                                          <span style={{ color: '#52c41a' }}>优点：</span>
                                          {analyses[item.id].pros.map((p, i) => (
                                            <div key={i} style={{ paddingLeft: 8, fontSize: 12 }}>+ {p}</div>
                                          ))}
                                        </div>
                                      )}
                                      {analyses[item.id].cons.length > 0 && (
                                        <div style={{ marginBottom: 4 }}>
                                          <span style={{ color: '#ff4d4f' }}>注意：</span>
                                          {analyses[item.id].cons.map((c, i) => (
                                            <div key={i} style={{ paddingLeft: 8, fontSize: 12 }}>- {c}</div>
                                          ))}
                                        </div>
                                      )}
                                      {analyses[item.id].distanceAdvice && (
                                        <div style={{ color: '#1677ff', marginTop: 6, padding: '6px 8px', background: '#e6f0ff', borderRadius: 6, fontSize: 12 }}>
                                          {analyses[item.id].distanceAdvice}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>

                            {editingField?.itemId === item.id && editingField?.field === 'note' ? (
                              <input
                                defaultValue={item.note}
                                autoFocus
                                placeholder="添加备注..."
                                onBlur={e => saveItemField(item.id, 'note', e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') saveItemField(item.id, 'note', e.currentTarget.value); if (e.key === 'Escape') setEditingField(null); }}
                                style={{ fontSize: 12, padding: '2px 6px', width: '100%', marginTop: 4, color: '#666' }}
                              />
                            ) : (
                              <p className="item-note" onClick={() => setEditingField({ itemId: item.id, field: 'note' })} style={{ cursor: 'pointer' }} title="点击编辑">
                                {item.note ? `备注：${item.note}` : '+ 添加备注'}
                              </p>
                            )}
                          </div>
                          <button className="btn-delete" onClick={() => handleDelete(item.id)}>×</button>
                        </div>
                        {dragOverDayId === day.id && dragOverAfterId === item.id && (
                          <div style={{
                            height: 4, background: '#1677ff', borderRadius: 2,
                            margin: '6px 0', transition: 'margin 0.15s',
                          }} />
                        )}
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>
          );
        })}</div>

      {chatOpen && (
        <div style={{
          width: 380, flexShrink: 0, background: '#fff',
          borderLeft: '1px solid #eee', display: 'flex', flexDirection: 'column',
          height: 'calc(100vh - 56px)', position: 'sticky', top: 56,
        }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #eee', fontWeight: 600, fontSize: 15 }}>
            AI 行程助手
          </div>
          <div
            ref={chatRef}
            style={{
              flex: 1, overflow: 'auto', padding: 12,
              display: 'flex', flexDirection: 'column', gap: 8,
            }}
          >
            {chatMessages.map((msg, i) => (
              <div key={i} style={{
                textAlign: msg.role === 'user' ? 'right' : 'left',
              }}>
                <div style={{
                  display: 'inline-block',
                  background: msg.role === 'user' ? '#1677ff' : '#f5f5f5',
                  color: msg.role === 'user' ? '#fff' : '#333',
                  padding: '8px 12px', borderRadius: 12,
                  maxWidth: '90%', fontSize: 13,
                  whiteSpace: 'pre-wrap', textAlign: 'left',
                  lineHeight: 1.6,
                }}>
                  {msg.text}
                </div>
              </div>
            ))}
            {chatting && (
              <div style={{ color: '#999', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                <div className="spinner" /> AI 思考中...
              </div>
            )}
          </div>
          <div style={{ padding: 12, borderTop: '1px solid #eee', display: 'flex', gap: 8 }}>
            <input
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleChat(); }}
              placeholder="例如：把第二天酒店换便宜点..."
              style={{ flex: 1, fontSize: 13, padding: '8px 10px' }}
            />
            <button className="btn-primary btn-sm" onClick={handleChat} disabled={chatting || !chatInput.trim()}>
              发送
            </button>
          </div>
        </div>
      )}
    </div>
    </div>
  );
}
