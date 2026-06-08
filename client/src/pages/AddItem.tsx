import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { getTrip, addItem, parseLink, type Trip, type Day, type ParseResult } from '../api';
import { useT } from '../i18n';

export default function AddItem() {
  const { t } = useT();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [parseUrl, setParseUrl] = useState('');
  const [parsing, setParsing] = useState(false);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [parseError, setParseError] = useState('');

  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [type, setType] = useState('hotel');
  const [price, setPrice] = useState('');
  const [dayId, setDayId] = useState(searchParams.get('dayId') || '');
  const [note, setNote] = useState('');
  const [source, setSource] = useState('manual');
  const [sourceUrl, setSourceUrl] = useState('');
  const [imageUrl, setImageUrl] = useState('');

  useEffect(() => {
    if (!id) return;
    getTrip(id).then(setTrip);
  }, [id]);

  useEffect(() => {
    if ('clipboard' in navigator && (navigator as any).clipboard?.readText) {
      (navigator as any).clipboard.readText().then((text: string) => {
        if (/^https?:\/\//.test(text.trim())) {
          setParseUrl(text.trim());
        }
      }).catch(() => {});
    }
  }, []);

  async function handleParse() {
    if (!parseUrl.trim()) return;
    setParsing(true);
    setParseError('');
    setParseResult(null);
    try {
      const result = await parseLink(parseUrl.trim());
      setParseResult(result);
      if (result.title) setTitle(result.title);
      if (result.type) setType(result.type);
      if (result.price) setPrice(String(result.price));
      if (result.imageUrl) setImageUrl(result.imageUrl);
      if (result.source) setSource(result.source);
      setSourceUrl(parseUrl.trim());
    } catch (err: any) {
      setParseError(err.message);
    } finally {
      setParsing(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !dayId) return;

    await addItem(id!, {
      dayId,
      title: title.trim(),
      subtitle: subtitle.trim(),
      type: type as any,
      price: price ? parseFloat(price) : null,
      source: source as any,
      sourceUrl: sourceUrl || null,
      imageUrl: imageUrl || null,
      note: note.trim(),
    });

    navigate(`/trip/${id}`);
  }

  if (!trip) return <div className="loading">{t('common.loading')}</div>;

  return (
    <div className="page">
      <div className="header">
        <button className="btn btn-sm" onClick={() => navigate(`/trip/${id}`)}>{t('common.back')}</button>
        <h3>{t('addItem.title')}</h3>
      </div>

      <div className="parse-section">
        <div className="parse-hint">{t('addItem.parseHint')}</div>
        <div className="parse-input-row">
          <input
            type="url"
            placeholder="https://..."
            value={parseUrl}
            onChange={e => setParseUrl(e.target.value)}
          />
          <button className="btn btn-sm" onClick={handleParse} disabled={parsing}>
            {parsing ? t('addItem.parsing') : t('addItem.parse')}
          </button>
        </div>
        {parseError && <div className="error">{parseError}</div>}
        {parseResult && (
          <div className={`parse-result ${parseResult.confidence === 'low' ? 'confidence-low' : 'confidence-high'}`}>
            {parseResult.confidence === 'low' ? t('addItem.incomplete') : t('addItem.autoDetected')}
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label>{t('addItem.formTitle')} *</label>
          <input value={title} onChange={e => setTitle(e.target.value)} required />
        </div>

        <div className="form-group">
          <label>{t('addItem.formSubtitle')}</label>
          <input value={subtitle} onChange={e => setSubtitle(e.target.value)} />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>{t('addItem.formType')}</label>
            <select value={type} onChange={e => setType(e.target.value)}>
              <option value="hotel">{t('type.hotel')}</option>
              <option value="attraction">{t('type.attraction')}</option>
              <option value="traffic">{t('type.traffic')}</option>
              <option value="meal">{t('type.meal')}</option>
              <option value="custom">{t('type.custom')}</option>
            </select>
          </div>
          <div className="form-group">
            <label>{t('addItem.formPrice')}</label>
            <input type="number" value={price} onChange={e => setPrice(e.target.value)} placeholder="0" />
          </div>
        </div>

        <div className="form-group">
          <label>{t('addItem.formDay')}</label>
          <select value={dayId} onChange={e => setDayId(e.target.value)} required>
            <option value="">{t('addItem.selectDay')}</option>
            {trip.days.map((d: Day) => (
              <option key={d.id} value={d.id}>
                {d.label} ({new Date(d.date).toLocaleDateString('zh-CN')})
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label>{t('addItem.formSource')}</label>
          <select value={source} onChange={e => setSource(e.target.value)}>
            <option value="ctrip">{t('source.ctrip')}</option>
            <option value="mafengwo">{t('source.mafengwo')}</option>
            <option value="fliggy">{t('source.fliggy')}</option>
            <option value="meituan">{t('source.meituan')}</option>
            <option value="qunar">{t('source.qunar')}</option>
            <option value="manual">{t('source.manual')}</option>
          </select>
        </div>

        <div className="form-group">
          <label>{t('addItem.formSourceUrl')}</label>
          <input value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} placeholder="https://..." />
        </div>

        <div className="form-group">
          <label>{t('addItem.formImageUrl')}</label>
          <input value={imageUrl} onChange={e => setImageUrl(e.target.value)} placeholder="https://..." />
        </div>

        <div className="form-group">
          <label>{t('addItem.formNote')}</label>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} />
        </div>

        <button type="submit" className="btn btn-full">{t('addItem.submit')}</button>
      </form>
    </div>
  );
}
