import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { getTrip, updateTrip, updateItem, updateItemStatus, deleteItem, analyzeItem, downloadExport, reorderItem, proxyImageUrl, type Trip, type ItemAnalysis } from '../api';
import { useT } from '../i18n';
import { buildSearchUrl } from '../lib/searchUrls';
import ChatPanel from '../components/ChatPanel';

const TYPE_ORDER: Record<string, number> = { traffic: 0, hotel: 1, attraction: 2, meal: 3, custom: 4 };

function sortItems(items: any[]): any[] {
  return [...items].sort((a, b) => {
    const oa = TYPE_ORDER[a.type] ?? 5;
    const ob = TYPE_ORDER[b.type] ?? 5;
    if (oa !== ob) return oa - ob;
    return a.sortOrder - b.sortOrder;
  });
}

export default function TripDetail({ onTripsChange: _onTripsChange }: { onTripsChange?: () => void }) {
  const { t } = useT();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [titleDraft, setTitleDraft] = useState('');
  const titleRef = useRef('');
  const savingRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [analyses, setAnalyses] = useState<Record<string, ItemAnalysis>>({});
  const [expandedAnalysis, setExpandedAnalysis] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const chatOpen = searchParams.get('chat') === '1';
  const [editingField, setEditingField] = useState<{ itemId: string; field: string } | null>(null);
  const [_dragItemId, setDragItemId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const dragItemRef = useRef<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    getTrip(id).then(t => {
      setTrip(t);
      setTitleDraft(t.title);
      titleRef.current = t.title;
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

  async function saveTitle() {
    if (savingRef.current) return;
    const val = titleRef.current.trim();
    if (!val || !trip) return;
    savingRef.current = true;
    try {
      await updateTrip(trip.id, { title: val, destination: trip.destination, startDate: trip.startDate, endDate: trip.endDate });
      setTrip(prev => prev ? { ...prev, title: val } : prev);
    } catch (err: any) {
      alert(err.message || t('common.failed'));
    } finally {
      savingRef.current = false;
    }
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

  // ==================== Chat ====================

  function openChat() {
    setSearchParams(prev => { prev.set('chat', '1'); return prev; });
  }
  function closeChat() {
    setSearchParams(prev => { prev.delete('chat'); return prev; });
  }

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
              value={titleDraft}
              onChange={e => { setTitleDraft(e.target.value); titleRef.current = e.target.value; }}
              onBlur={() => saveTitle()}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
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
              onDragOver={e => e.preventDefault()}
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
                          {t(item.status === 'pending' ? 'tripDetail.pending' : item.status === 'purchased' ? 'tripDetail.purchased' : 'tripDetail.cancelled')}
                        </button>
                      </div>

                      <div className="block-actions">
                        {item.sourceUrl ? (
                          <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" className="block-link block-link-primary">{t('tripDetail.openSource')}</a>
                        ) : (
                          <a href={buildSearchUrl('ctrip', item, trip.destination, { start: trip.startDate, end: trip.endDate })} target="_blank" rel="noopener noreferrer" className="block-link block-link-primary">{t('tripDetail.searchCtrip')}</a>
                        )}
                        <a href={buildSearchUrl('fliggy', item, trip.destination)} target="_blank" rel="noopener noreferrer" className="block-link">{t('source.fliggy')}</a>
                        <a href={buildSearchUrl('tongcheng', item, trip.destination)} target="_blank" rel="noopener noreferrer" className="block-link">{t('site.tongcheng')}</a>
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

      {chatOpen && trip && (
        <ChatPanel
          trip={trip}
          onTripUpdate={setTrip}
          onClose={closeChat}
        />
      )}
    </div>
  );
}
