import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getTrip, getTrips, createTrip, addItem, importFile, aiParseText, parseUrlToTrip, type Trip, type ImportResult } from '../api';

function defaultDates() {
  const now = new Date();
  const sat = new Date(now);
  sat.setDate(sat.getDate() + ((6 - now.getDay() + 7) % 7));
  if (sat.getDay() !== 6) sat.setDate(sat.getDate() + 6 - sat.getDay());
  const end = new Date(sat);
  end.setDate(end.getDate() + 2);
  return {
    startDate: sat.toISOString().split('T')[0],
    endDate: end.toISOString().split('T')[0],
  };
}

export default function ImportTrip() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [isNewTrip, setIsNewTrip] = useState(false);
  const [importMode, setImportMode] = useState<'file' | 'url'>('file');
  const [file, setFile] = useState<File | null>(null);
  const [importUrl, setImportUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [aiParsing, setAiParsing] = useState(false);

  useEffect(() => {
    if (id) {
      getTrip(id).then(setTrip);
    } else {
      getTrips().then(setTrips);
    }
  }, [id]);

  async function handleImport() {
    if (!file) return;
    setImporting(true);
    setError('');
    try {
      const res = await importFile(file);
      setResult(res);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  }

  async function handleUrlImport() {
    if (!importUrl.trim()) return;
    setImporting(true);
    setError('');
    try {
      const res = await parseUrlToTrip(importUrl.trim());
      setResult(res);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  }

  async function handleAIParse() {
    if (!result?.rawText) return;
    setAiParsing(true);
    setError('');
    try {
      const parsed = await aiParseText(result.rawText);
      setResult({ ...parsed, rawText: result.rawText });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setAiParsing(false);
    }
  }

  async function handleConfirm() {
    if (!result) return;
    setSaving(true);

    try {
      let targetTrip = trip;

      if (!targetTrip) {
        // Creating new trip from parsed data
        const dates = defaultDates();
        const d = result;
        targetTrip = await createTrip({
          title: d.title || '导入行程',
          destination: d.destination || '未知目的地',
          startDate: d.startDate || dates.startDate,
          endDate: d.endDate || dates.endDate,
        });
      }

      for (let di = 0; di < result.days.length; di++) {
        const day = result.days[di];
        const tripDay = targetTrip.days[di];
        if (!tripDay) break;

        for (const item of day.items) {
          await addItem(targetTrip.id, {
            dayId: tripDay.id,
            type: item.type as any,
            title: item.title,
            subtitle: item.subtitle || '',
            price: item.price || null,
            note: item.note || '',
            sourceUrl: item.sourceUrl || null,
          });
        }
      }

      navigate(`/trip/${targetTrip.id}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  // ---- Step 1: Pick destination trip (standalone only) ----
  const [selectedTripId, setSelectedTripId] = useState(id || '');
  const [picked, setPicked] = useState(!!id);

  if (!id && !picked) {
    return (
      <div className="page">
        <header className="header">
          <button className="btn-sm" onClick={() => navigate('/')}>← 返回</button>
          <h3>导入行程</h3>
        </header>
        <div className="container">
          <p className="parse-hint" style={{ marginBottom: 12 }}>选择导入方式：</p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button
              className="btn-primary btn-full"
              onClick={() => {
                setSelectedTripId('new');
                setIsNewTrip(true);
                setPicked(true);
              }}
            >
              + 新建行程（由导入内容自动生成）
            </button>

            <p className="parse-hint" style={{ textAlign: 'center', margin: '4px 0' }}>或导入到已有行程：</p>

            {trips.length === 0 ? (
              <div className="empty">还没有行程</div>
            ) : (
              <select
                value={selectedTripId}
                onChange={e => setSelectedTripId(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', fontSize: 14 }}
              >
                <option value="">选择行程...</option>
                {trips.map(t => (
                  <option key={t.id} value={t.id}>{t.title} — {t.destination}</option>
                ))}
              </select>
            )}

            <button
              className="btn-primary btn-full"
              disabled={!selectedTripId || selectedTripId === 'new'}
              onClick={() => {
                getTrip(selectedTripId).then(t => {
                  setTrip(t);
                  setPicked(true);
                });
              }}
              style={{ background: '#722ed1' }}
            >
              导入到已有行程
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- Step 2: Import content ----
  const targetTrip = trip;

  return (
    <div className="page">
      <header className="header">
        <button className="btn-sm" onClick={() => navigate(trip ? `/trip/${trip.id}` : '/')}>← 返回</button>
        <h3>导入行程 {isNewTrip ? '(新建)' : targetTrip ? `→ ${targetTrip.title}` : ''}</h3>
      </header>

      <div className="container">
        <div className="parse-section">
          <div style={{ display: 'flex', gap: 0, marginBottom: 16 }}>
            <button
              className="btn-sm"
              style={{ flex: 1, borderRadius: '8px 0 0 8px', background: importMode === 'file' ? '#1677ff' : '#f0f0f0', color: importMode === 'file' ? '#fff' : '#333', border: 'none' }}
              onClick={() => setImportMode('file')}
            >上传文件</button>
            <button
              className="btn-sm"
              style={{ flex: 1, borderRadius: '0 8px 8px 0', background: importMode === 'url' ? '#1677ff' : '#f0f0f0', color: importMode === 'url' ? '#fff' : '#333', border: 'none' }}
              onClick={() => setImportMode('url')}
            >粘贴链接</button>
          </div>

        {importMode === 'file' ? (
          <>
            <p className="parse-hint">支持 Word (.docx)、Excel (.xlsx/.csv)、Markdown (.md) 文件</p>
            <p className="parse-hint" style={{ fontSize: 12, marginTop: 4 }}>
              Excel 列名支持: 天/Day/Label、类型/Type、标题/Title/名称、价格/Price/费用、备注/Note
            </p>
          </>
        ) : (
          <p className="parse-hint">粘贴携程、飞猪、马蜂窝等网站的跟团游/自由行链接，AI 自动解析为自由行行程</p>
        )}

          {!result && (
            <>
              {importMode === 'file' ? (
                <div className="parse-input-row" style={{ flexDirection: 'column', gap: 12 }}>
                  <input
                    type="file"
                    accept=".docx,.md,.xlsx,.xls,.csv,.txt"
                    onChange={e => setFile(e.target.files?.[0] || null)}
                  />
                  <button
                    onClick={handleImport}
                    disabled={!file || importing}
                    className="btn-primary btn-full"
                  >
                    {importing ? '解析中...' : '开始导入'}
                  </button>
                </div>
              ) : (
                <div className="parse-input-row" style={{ flexDirection: 'column', gap: 12 }}>
                  <input
                    type="url"
                    placeholder="粘贴跟团游/自由行链接..."
                    value={importUrl}
                    onChange={e => setImportUrl(e.target.value)}
                  />
                  <button
                    onClick={handleUrlImport}
                    disabled={!importUrl.trim() || importing}
                    className="btn-primary btn-full"
                    style={{ background: '#722ed1' }}
                  >
                    {importing ? 'AI 解析中...' : 'AI 智能解析'}
                  </button>
                </div>
              )}
              {error && <div className="error">{error}</div>}
            </>
          )}

          {result && (
            <div className="parse-result confidence-high" style={{ marginBottom: 16 }}>
              ✅ 成功解析 {result.days.length} 天，共 {result.days.reduce((n, d) => n + d.items.length, 0)} 个项目
              {result.title && <div style={{ marginTop: 4, fontSize: 13 }}>行程: {result.title}</div>}
              {result.destination && <div style={{ fontSize: 13 }}>目的地: {result.destination}</div>}
              {result.rawText && (
                <div style={{ marginTop: 8, fontSize: 13, color: '#666' }}>
                  未能结构化解析，已将原始文本保留
                </div>
              )}
            </div>
          )}
        </div>

        {result && result.days.length > 0 && (
          <>
            <div className="preview-section">
              <h4 style={{ marginBottom: 12 }}>预览导入内容</h4>
              {result.days.map((day, di) => (
                <div key={di} className="day-section">
                  <div className="day-header">
                    <span className="day-label">{day.label || `第${di + 1}天`}</span>
                    {targetTrip && (
                      <span className="day-date" style={{ color: '#1677ff', fontSize: 12 }}>
                        将导入至: {targetTrip.days[di]?.label || '?'}
                      </span>
                    )}
                  </div>
                  <div className="item-list">
                    {day.items.map((item, ii) => (
                      <div key={ii} className="item-card" style={{ opacity: 1 }}>
                        <div className="item-body">
                          <div className="item-type" style={{ fontSize: 11 }}>
                            {({ hotel: '🏨 酒店', attraction: '🎫 景点', traffic: '🚄 交通', meal: '🍽 餐饮', custom: '📌 其他' } as any)[item.type] || item.type}
                          </div>
                          <h4 className="item-title">{item.title}</h4>
                          {item.subtitle && <p className="item-subtitle">{item.subtitle}</p>}
                          <div className="item-info">
                            {item.price && <span className="item-price">¥{item.price.toLocaleString()}</span>}
                            {item.note && <span className="item-note">{item.note}</span>}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button className="btn-sm" onClick={() => { setResult(null); setFile(null); setImportUrl(''); }}>重新导入</button>
              <button className="btn-primary" onClick={handleConfirm} disabled={saving}>
                {saving ? '导入中...' : (isNewTrip ? '创建行程并导入' : '确认导入到当前行程')}
              </button>
            </div>
          </>
        )}

        {result && result.days.length === 0 && result.rawText && (
          <div className="parse-section">
            <div className="parse-result confidence-low">
              ⚠️ 未能自动结构化，可通过 AI 解析生成行程
            </div>
            <button
              className="btn-primary btn-full"
              style={{ marginTop: 12, background: '#722ed1' }}
              onClick={handleAIParse}
              disabled={aiParsing}
            >
              {aiParsing ? 'AI 解析中...' : '使用 AI 智能解析'}
            </button>
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13, background: '#f5f5f5', padding: 12, borderRadius: 8, marginTop: 12, maxHeight: 300, overflow: 'auto' }}>
              {result.rawText.slice(0, 2000)}
              {result.rawText.length > 2000 && '\n\n... (内容已截断)'}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
