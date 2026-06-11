import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getTrip, getTrips, createTrip, addItem, importFile, aiParseText, parseUrlToTrip, type Trip, type ImportResult } from '../api';
import { useT } from '../i18n';

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

const IMPORT_STATE_KEY = 'import_state';

function loadImportState() {
  try { const raw = localStorage.getItem(IMPORT_STATE_KEY); if (raw) return JSON.parse(raw); } catch {}
  return null;
}
function saveImportState(state: any) {
  try { localStorage.setItem(IMPORT_STATE_KEY, JSON.stringify(state)); } catch {}
}
function clearImportState() {
  localStorage.removeItem(IMPORT_STATE_KEY);
}

export default function ImportTrip({ trips: propTrips, onTripsChange, onClose }: { trips?: Trip[]; onTripsChange?: () => Promise<void>; onClose?: () => void }) {
  const { t } = useT();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const saved = loadImportState();
  const [localTrips, setLocalTrips] = useState<Trip[]>([]);
  const trips = propTrips ?? localTrips;
  const [trip, setTrip] = useState<Trip | null>(null);
  const [isNewTrip, setIsNewTrip] = useState(saved?.isNewTrip || false);
  const [importMode, setImportMode] = useState<'file' | 'url'>(saved?.importMode || 'file');
  const [file, setFile] = useState<File | null>(null);
  const [importUrl, setImportUrl] = useState(saved?.importUrl || '');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(saved?.result || null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [aiParsing, setAiParsing] = useState(false);

  useEffect(() => {
    const state: any = { importMode, importUrl, isNewTrip };
    if (result) state.result = result;
    saveImportState(state);
  }, [importMode, importUrl, isNewTrip, result]);

  useEffect(() => {
    if (id) {
      getTrip(id).then(setTrip);
    } else {
      getTrips().then(setLocalTrips);
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
        const dates = defaultDates();
        const d = result;
        targetTrip = await createTrip({
          title: d.title || t('import.title'),
          destination: d.destination || 'Unknown',
          startDate: d.startDate || dates.startDate,
          endDate: d.endDate || dates.endDate,
        });
        await onTripsChange?.();
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

      clearImportState();
      navigate(`/trip/${targetTrip.id}`);
      onClose?.();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const [selectedTripId, setSelectedTripId] = useState(id || '');
  const [picked, setPicked] = useState(!!id);

  if (!id && !picked) {
    return (
      <div className="page">
        <div className="header">
          <button className="btn btn-sm" onClick={() => { clearImportState(); onClose ? onClose() : navigate('/'); }}>{t('common.back')}</button>
          <h3>{t('import.title')}</h3>
        </div>
        <div>
          <p className="section-hint">{t('import.chooseMethod')}</p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button
              className="btn btn-full"
              onClick={() => {
                setSelectedTripId('new');
                setIsNewTrip(true);
                setPicked(true);
              }}
            >
              {t('import.newTrip')}
            </button>

            <p className="section-hint" style={{ textAlign: 'center', margin: '4px 0' }}>{t('import.orExisting')}</p>

            {trips.length === 0 ? (
              <div className="empty">{t('import.noTrips')}</div>
            ) : (
              <select
                value={selectedTripId}
                onChange={e => setSelectedTripId(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', fontSize: 14, border: '1px solid #e9e9e7', borderRadius: 4, background: '#fff' }}
              >
                <option value="">{t('import.selectTrip')}</option>
                {trips.map(t => (
                  <option key={t.id} value={t.id}>{t.title} &mdash; {t.destination}</option>
                ))}
              </select>
            )}

            <button
              className="btn btn-full"
              disabled={!selectedTripId || selectedTripId === 'new'}
              onClick={() => {
                getTrip(selectedTripId).then(t => {
                  setTrip(t);
                  setPicked(true);
                });
              }}
            >
              {t('import.importExisting')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const targetTrip = trip;

  return (
    <div className="page">
      <div className="header">
        <button className="btn btn-sm" onClick={() => { clearImportState(); onClose ? onClose() : navigate(trip ? `/trip/${trip.id}` : '/'); }}>{t('common.back')}</button>
        <h3>{t('import.title')} {isNewTrip ? `(${t('import.newLabel')})` : targetTrip ? `-> ${targetTrip.title}` : ''}</h3>
      </div>

      <div>
        <div style={{ display: 'flex', gap: 0, marginBottom: 16 }} className="import-tabs">
          <button
            className={`btn btn-sm ${importMode === 'file' ? '' : 'btn-secondary'}`}
            style={{ flex: 1, borderRadius: '8px 0 0 8px', border: 'none', background: importMode === 'file' ? '#37352f' : '#f0f0f0', color: importMode === 'file' ? '#fff' : '#37352f' }}
            onClick={() => setImportMode('file')}
          >{t('import.uploadFile')}</button>
          <button
            className={`btn btn-sm ${importMode === 'url' ? '' : 'btn-secondary'}`}
            style={{ flex: 1, borderRadius: '0 8px 8px 0', border: 'none', background: importMode === 'url' ? '#37352f' : '#f0f0f0', color: importMode === 'url' ? '#fff' : '#37352f' }}
            onClick={() => setImportMode('url')}
          >{t('import.pasteUrl')}</button>
        </div>

        {importMode === 'file' ? (
          <>
            <p className="parse-hint">{t('import.fileHint')}</p>
            <p className="parse-hint" style={{ fontSize: 12, marginTop: 4 }}>{t('import.excelHint')}</p>
          </>
        ) : (
          <p className="parse-hint">{t('import.urlHint')}</p>
        )}

        {!result && (
          <>
            {importMode === 'file' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <input
                  type="file"
                  accept=".docx,.md,.xlsx,.xls,.csv,.txt"
                  onChange={e => setFile(e.target.files?.[0] || null)}
                  style={{ fontSize: 14 }}
                />
                <button onClick={handleImport} disabled={!file || importing} className="btn btn-full">
                  {importing ? t('import.parsing') : t('import.import')}
                </button>
              </div>
            ) : (
              <div className="parse-input-row" style={{ flexDirection: 'column', gap: 12 }}>
                <input
                  type="url"
                  placeholder={t('import.urlHint')}
                  value={importUrl}
                  onChange={e => setImportUrl(e.target.value)}
                />
                <button
                  onClick={handleUrlImport}
                  disabled={!importUrl.trim() || importing}
                  className="btn btn-full"
                >
                  {importing ? t('import.aiParsing') : t('import.aiParse')}
                </button>
              </div>
            )}
            {error && <div className="error">{error}</div>}
          </>
        )}

        {result && (
          <div className="parse-result confidence-high" style={{ marginBottom: 16 }}>
            {t('import.parsed')} {result.days.length} {t('import.parsedDays')}, {result.days.reduce((n, d) => n + d.items.length, 0)} {t('import.parsedItems')}
            {result.title && <div style={{ marginTop: 4, fontSize: 13 }}>{t('import.tripLabel')}: {result.title}</div>}
            {result.destination && <div style={{ fontSize: 13 }}>{t('import.destinationLabel')}: {result.destination}</div>}
            {result.rawText && (
              <div style={{ marginTop: 8, fontSize: 13, color: '#9b9a97' }}>
                {t('import.rawTextNote')}
              </div>
            )}
          </div>
        )}
      </div>

      {result && result.days.length > 0 && (
        <>
          <div className="preview-section">
            <h4 style={{ marginBottom: 12, fontWeight: 600 }}>{t('import.preview')}</h4>
            {result.days.map((day, di) => (
              <div key={di} className="day-section">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', marginBottom: 4 }}>
                  <span style={{ fontSize: 16, fontWeight: 600 }}>{day.label || `${t('import.day')}${di + 1}${t('import.daySuffix')}`}</span>
                  {targetTrip && (
                    <span style={{ color: '#9b9a97', fontSize: 12 }}>
                      {t('import.importTo')}: {targetTrip.days[di]?.label || '?'}
                    </span>
                  )}
                </div>
                <div className="item-list">
                  {day.items.map((item, ii) => (
                    <div key={ii} className="item-card">
                      <div className="item-body">
                        <div className="item-type">{t(`type.${item.type}`)}</div>
                        <h4 className="item-title">{item.title}</h4>
                        {item.subtitle && <p className="item-subtitle">{item.subtitle}</p>}
                        <div className="item-info">
                          {item.price && <span className="item-price">{item.price.toLocaleString()}</span>}
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
            <button className="btn btn-sm btn-secondary" onClick={() => { setResult(null); setFile(null); setImportUrl(''); }}>{t('import.reimport')}</button>
            <button className="btn" onClick={handleConfirm} disabled={saving}>
              {saving ? t('import.importing') : (isNewTrip ? t('import.createAndImport') : t('import.confirm'))}
            </button>
          </div>
        </>
      )}

      {result && result.days.length === 0 && result.rawText && (
        <div className="parse-section">
          <div className="parse-result confidence-low">
            {t('import.structuredFailed')}
          </div>
          <button
            className="btn btn-full"
            style={{ marginTop: 12 }}
            onClick={handleAIParse}
            disabled={aiParsing}
          >
            {aiParsing ? t('import.aiParsing') : t('import.aiParseBtn')}
          </button>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13, background: '#f7f6f3', padding: 12, borderRadius: 6, marginTop: 12, maxHeight: 300, overflow: 'auto', border: '1px solid #e9e9e7' }}>
            {result.rawText.slice(0, 2000)}
            {result.rawText.length > 2000 && '\n\n' + t('import.truncated')}
          </pre>
        </div>
      )}
    </div>
  );
}
