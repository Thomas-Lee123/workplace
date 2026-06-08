import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { getTrip, updateTrip, updateItem, updateItemStatus, deleteItem, analyzeItem, streamAIChat, aiApplyChanges, reorderItem, downloadExport, proxyImageUrl, type Trip, type ItemAnalysis, type SSEEvent } from '../api';
import { useT } from '../i18n';

const TYPE_ORDER: Record<string, number> = { traffic: 0, hotel: 1, attraction: 2, meal: 3, custom: 4 };

function sortItems(items: any[]): any[] {
  return [...items].sort((a, b) => {
    const oa = TYPE_ORDER[a.type] ?? 5;
    const ob = TYPE_ORDER[b.type] ?? 5;
    if (oa !== ob) return oa - ob;
    return a.sortOrder - b.sortOrder;
  });
}

export default function TripDetail({ onTripsChange }: { onTripsChange?: () => void }) {
  void onTripsChange;
  const { t } = useT();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [analyses, setAnalyses] = useState<Record<string, ItemAnalysis>>({});
  const [expandedAnalysis, setExpandedAnalysis] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const chatOpen = searchParams.get('chat') === '1';
  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'ai'; text: string }[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatting, setChatting] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const ctrlRef = useRef<AbortController | null>(null);
  const [editingField, setEditingField] = useState<{ itemId: string; field: string } | null>(null);
  const [_dragItemId, setDragItemId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const dragItemRef = useRef<string | null>(null);

  useEffect(() => {
    if (!id) return;
    getTrip(id).then(t => {
      setTrip(t);
      const saved: Record<string, ItemAnalysis> = {};
      for (const day of t.days) {
        for (const item of day.items) {
          if (item.meta?.analysis) saved[item.id] = item.meta.analysis;
        }
      }
      if (Object.keys(saved).length > 0) setAnalyses(saved);
    }).finally(() => setLoading(false));
  }, [id]);

  // Listen for export custom event
  useEffect(() => {
    const onExport = (e: Event) => handleExport((e as CustomEvent).detail);
    window.addEventListener('trip:export', onExport);
    return () => window.removeEventListener('trip:export', onExport);
  }, [id]);

  async function toggleStatus(itemId: string, current: string) {
    const next = current === 'pending' ? 'purchased' : current === 'purchased' ? 'cancelled' : 'pending';
    await updateItemStatus(id!, itemId, next);
    setTrip(prev => prev ? { ...prev, days: prev.days.map(d => ({ ...d, items: d.items.map(i => i.id === itemId ? { ...i, status: next } : i) })) } : prev);
  }

  async function saveField(itemId: string, field: string, val: string) {
    if (!id) return;
    await updateItem(id, itemId, { [field]: val } as any);
    setTrip(prev => prev ? { ...prev, days: prev.days.map(d => ({ ...d, items: d.items.map(i => i.id === itemId ? { ...i, [field]: val } : i) })) } : prev);
    setEditingField(null);
  }

  async function saveTitle(val: string) {
    if (!val.trim() || !trip) return;
    await updateTrip(trip.id, { title: val.trim(), destination: trip.destination, startDate: trip.startDate, endDate: trip.endDate });
    setTrip(prev => prev ? { ...prev, title: val.trim() } : prev);
  }

  async function handlePasteLink(itemId: string, url: string) {
    if (!url.trim()) return;
    await updateItem(id!, itemId, { sourceUrl: url.trim() } as any);
    setAnalyzing(itemId);
    try {
      const analysis = await analyzeItem(url.trim(), id!);
      setAnalyses(prev => ({ ...prev, [itemId]: analysis }));
      const updates: any = { sourceUrl: url.trim() };
      if (analysis.title) updates.title = analysis.title;
      if (analysis.type) updates.type = analysis.type;
      if (analysis.price != null) updates.price = analysis.price;
      if (analysis.imageUrl) updates.imageUrl = analysis.imageUrl;
      updates.meta = { analysis };
      await updateItem(id!, itemId, updates);
      setTrip(prev => {
        if (!prev) return prev;
        return { ...prev, days: prev.days.map(d => ({ ...d, items: d.items.map(i => i.id === itemId ? { ...i, ...updates } : i) })) };
      });
    } catch {} finally { setAnalyzing(null); }
  }

  async function handleDelete(itemId: string) {
    if (!confirm(t('tripDetail.deleteConfirm'))) return;
    await deleteItem(id!, itemId);
    setTrip(prev => prev ? { ...prev, days: prev.days.map(d => ({ ...d, items: d.items.filter(i => i.id !== itemId) })) } : prev);
  }

  async function handleExport(format: 'xlsx' | 'doc') {
    if (!id || exporting) return;
    setExporting(true);
    try { await downloadExport(id, format); } catch (err: any) { alert(err.message || t('tripDetail.exportFailed')); }
    setExporting(false);
  }

  // ==================== Drag & Drop ====================

  function handleDragStart(_e: React.DragEvent, itemId: string) {
    dragItemRef.current = itemId;
    setDragItemId(itemId);
  }
  function handleDragEnd() { dragItemRef.current = null; setDragItemId(null); }

  function handleDayDragOver(e: React.DragEvent) {
    e.preventDefault();
  }

  async function handleDrop(e: React.DragEvent, targetDayId: string) {
    e.preventDefault();
    const itemId = dragItemRef.current;
    if (!itemId || !trip) return;
    dragItemRef.current = null; setDragItemId(null);

    let sourceDayId = '';
    for (const day of trip.days) {
      if (day.items.find(i => i.id === itemId)) { sourceDayId = day.id; break; }
    }
    if (!sourceDayId || sourceDayId === targetDayId) return;

    try {
      const targetDay = trip.days.find(d => d.id === targetDayId)!;
      const maxOrder = targetDay.items.length > 0 ? Math.max(...targetDay.items.map(i => i.sortOrder)) : -1;
      await reorderItem(trip.id, itemId, maxOrder + 1, targetDayId);
      await getTrip(trip.id).then(setTrip);
    } catch (err: any) { alert(err.message || t('tripDetail.moveFailed')); }
  }

  // ==================== AI Chat ====================

  async function handleChat() {
    if (!chatInput.trim() || chatting || !trip) return;
    const msg = chatInput.trim();
    setChatInput('');
    setChatMessages(prev => [...prev, { role: 'user', text: msg }]);
    setChatting(true);
    let fullReply = '';
    ctrlRef.current = streamAIChat(trip.id, msg,
      (e: SSEEvent) => {
        if (e.content) { fullReply += e.content; setChatMessages(prev => { const c = [...prev]; const l = c[c.length - 1]; if (l?.role === 'ai') l.text = fullReply; else c.push({ role: 'ai', text: fullReply }); return c; }); }
      },
      async (tripData, changes) => {
        try { const updated = await aiApplyChanges(trip.id, tripData); setTrip(updated); setChatMessages(prev => [...prev, { role: 'ai', text: (changes || t('tripDetail.applied')) }]); } catch (err: any) { setChatMessages(prev => [...prev, { role: 'ai', text: t('common.failed') + ': ' + err.message }]); }
        setChatting(false);
      },
      (err: Error) => { setChatMessages(prev => [...prev, { role: 'ai', text: t('common.error') + ': ' + err.message }]); setChatting(false); },
    );
  }

  function openChat() {
    setSearchParams(prev => { prev.set('chat', '1'); return prev; });
    if (chatMessages.length === 0 && trip) {
      const days = trip.days.map(d => `${d.label}: ` + d.items.map(i => i.title).join(', ')).join('\n');
      setChatMessages([{ role: 'ai', text: `${t('tripDetail.chat')}:\n${days}` }]);
    }
  }
  function closeChat() {
    ctrlRef.current?.abort();
    setSearchParams(prev => { prev.delete('chat'); return prev; });
  }

  useEffect(() => {
    if (chatOpen && trip && chatMessages.length > 0) {
      try { localStorage.setItem(`chat_${trip.id}`, JSON.stringify(chatMessages)); } catch {}
    }
  }, [chatMessages, chatOpen, trip]);

  useEffect(() => {
    if (chatOpen && trip && chatMessages.length === 0) {
      try {
        const saved = localStorage.getItem(`chat_${trip.id}`);
        if (saved) setChatMessages(JSON.parse(saved));
      } catch {}
    }
  }, [chatOpen, trip]);

  useEffect(() => { if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight; }, [chatMessages]);

  // ==================== Render ====================

  if (loading) return <div className="loading">{t('common.loading')}</div>;
  if (!trip) return <div className="loading">{t('tripDetail.notFound')}</div>;

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, position: 'relative' }}>
      <div className="page" style={{ flex: 1, overflowY: 'auto' }}>
        {/* Title */}
        <div className="page-header">
          <div className="page-header-top">
            <input
              className="page-title"
              defaultValue={trip.title}
              onBlur={e => saveTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveTitle((e.target as HTMLInputElement).value); }}
            />
          </div>
          <div className="page-meta">
            <span>{trip.destination}</span>
            <span>{new Date(trip.startDate).toLocaleDateString('zh-CN')} — {new Date(trip.endDate).toLocaleDateString('zh-CN')}</span>
            <span>{trip.days.reduce((n, d) => n + d.items.length, 0)} {t('tripDetail.items')}</span>
            <span>{t('tripDetail.budget')}: {trip.days.reduce((n, d) => n + d.items.reduce((s, i) => s + (i.price || 0), 0), 0).toLocaleString()}</span>
          </div>
        </div>

        {/* Days */}
        {trip.days.map(day => {
          const sorted = sortItems(day.items);
          return (
            <div key={day.id} className="day"
              onDragOver={handleDayDragOver}
              onDrop={e => handleDrop(e, day.id)}
            >
              <div className="day-header">
                <span className="day-label">{day.label}</span>
                <span className="day-date">{new Date(day.date).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', weekday: 'short' })}</span>
                <button className="day-add" onClick={() => navigate(`/trip/${id}/add?dayId=${day.id}`)}>+</button>
              </div>

              {sorted.length === 0 ? (
                <div className="day-empty">{t('tripDetail.dropHere')}</div>
              ) : (
                sorted.map(item => (
                  <div key={item.id} className={`block ${item.status === 'purchased' ? 'status-purchased' : ''}`}>
                    <div
                      className="block-handle"
                      draggable
                      onDragStart={e => handleDragStart(e, item.id)}
                      onDragEnd={handleDragEnd}
                      title={t('tripDetail.dragToReorder')}
                    >
                      ⋮⋮
                    </div>

                    {item.imageUrl && (
                      <img src={proxyImageUrl(item.imageUrl)} alt="" className="block-img" />
                    )}

                    <div className="block-body">
                      <div className="block-type">
                        {t(`type.${item.type}`)}
                        {item.source !== 'manual' && <span className="block-link"> · {t(`source.${item.source}`)}</span>}
                      </div>

                      {editingField?.itemId === item.id && editingField?.field === 'title' ? (
                        <input className="block-title" defaultValue={item.title} autoFocus
                          onBlur={e => saveField(item.id, 'title', e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') saveField(item.id, 'title', e.currentTarget.value); if (e.key === 'Escape') setEditingField(null); }}
                        />
                      ) : (
                        <div className="block-title" onClick={() => setEditingField({ itemId: item.id, field: 'title' })}>
                          {item.title}
                        </div>
                      )}

                      {editingField?.itemId === item.id && editingField?.field === 'subtitle' ? (
                        <input className="block-subtitle" defaultValue={item.subtitle} autoFocus placeholder={t('tripDetail.subtitle')}
                          onBlur={e => saveField(item.id, 'subtitle', e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') saveField(item.id, 'subtitle', e.currentTarget.value); if (e.key === 'Escape') setEditingField(null); }}
                        />
                      ) : (
                        item.subtitle ? (
                          <div className="block-subtitle" onClick={() => setEditingField({ itemId: item.id, field: 'subtitle' })}>{item.subtitle}</div>
                        ) : null
                      )}

                      <div className="block-meta">
                        {item.price && <span className="block-price">{item.price.toLocaleString()}</span>}
                        <button className={`block-status ${item.status}`} onClick={() => toggleStatus(item.id, item.status)}>
                          {item.status === 'pending' ? t('tripDetail.pending') : item.status === 'purchased' ? t('tripDetail.purchased') : t('tripDetail.cancelled')}
                        </button>
                      </div>

                      <div className="block-actions">
                        {item.sourceUrl ? (
                          <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" className="block-link block-link-primary">{t('tripDetail.openSource')}</a>
                        ) : (
                          <a href={`https://hotels.ctrip.com/hotels/list?${new URLSearchParams({ cityName: trip.destination, destName: trip.destination, searchWord: item.title, searchType: 'D', optionId: '1', crn: '1', curr: 'CNY', locale: 'zh-CN' }).toString()}`} target="_blank" rel="noopener noreferrer" className="block-link block-link-primary">{t('tripDetail.searchCtrip')}</a>
                        )}
                        <a href={`https://www.fliggy.com/ifi/search.htm?q=${encodeURIComponent(item.title)}`} target="_blank" rel="noopener noreferrer" className="block-link">{t('source.fliggy')}</a>
                        <a href={`https://m.ly.com/hotel/search?keyword=${encodeURIComponent(item.title)}`} target="_blank" rel="noopener noreferrer" className="block-link">{t('site.tongcheng')}</a>
                        <input className="block-link-input" placeholder={t('tripDetail.pasteLink')}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              handlePasteLink(item.id, e.currentTarget.value);
                              e.currentTarget.value = '';
                            }
                          }}
                        />
                        {analyzing === item.id && <span style={{ fontSize: 12, color: '#9b9a97' }}>{t('tripDetail.analyzing')}</span>}
                      </div>

                      {analyses[item.id] && (
                        <div className="analysis-box">
                          <div className="analysis-header" onClick={() => setExpandedAnalysis(expandedAnalysis === item.id ? null : item.id)}>
                            <span>{t('tripDetail.analysis')}</span>
                            <span>{expandedAnalysis === item.id ? t('common.hide') : t('common.show')}</span>
                          </div>
                          {expandedAnalysis === item.id && (
                            <div className="analysis-body">
                              {analyses[item.id].pros.length > 0 && (
                                <div className="analysis-pros">{analyses[item.id].pros.map((p: string, i: number) => <div key={i}>+ {p}</div>)}</div>
                              )}
                              {analyses[item.id].cons.length > 0 && (
                                <div className="analysis-cons">{analyses[item.id].cons.map((c: string, i: number) => <div key={i}>- {c}</div>)}</div>
                              )}
                              {analyses[item.id].distanceAdvice && (
                                <div className="analysis-advice">{analyses[item.id].distanceAdvice}</div>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {editingField?.itemId === item.id && editingField?.field === 'note' ? (
                        <input className="block-note" defaultValue={item.note} autoFocus placeholder={t('tripDetail.note')}
                          onBlur={e => saveField(item.id, 'note', e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') saveField(item.id, 'note', e.currentTarget.value); if (e.key === 'Escape') setEditingField(null); }}
                        />
                      ) : (
                        item.note ? (
                          <div className="block-note" onClick={() => setEditingField({ itemId: item.id, field: 'note' })}>{item.note}</div>
                        ) : null
                      )}
                    </div>

                    <button className="block-delete" onClick={() => handleDelete(item.id)}>x</button>
                  </div>
                ))
              )}
            </div>
          );
        })}
      </div>

      {!chatOpen && (
        <button className="chat-float-btn" onClick={openChat}>
          {t('tripDetail.chatButton')}
        </button>
      )}

      {/* Chat panel */}
      {chatOpen && (
        <div className="chat-panel">
          <div className="chat-panel-header">
            {t('tripDetail.chat')}
            <button className="chat-panel-close" onClick={closeChat}>x</button>
          </div>
          <div className="chat-messages" ref={chatRef}>
            {chatMessages.map((msg, i) => (
              <div key={i} className={`chat-msg ${msg.role}`}>{msg.text}</div>
            ))}
            {chatting && <div style={{ color: '#9b9a97', fontSize: 12 }}>{t('tripDetail.thinking')}</div>}
          </div>
          <div className="chat-input-row">
            <input value={chatInput} onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleChat(); }}
              placeholder={t('tripDetail.chatPlaceholder')}
            />
            <button className="btn btn-sm" onClick={handleChat} disabled={chatting || !chatInput.trim()}>{t('common.send')}</button>
          </div>
        </div>
      )}
    </div>
  );
}
