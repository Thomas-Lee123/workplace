import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { getTrip, addItem, parseLink, type Trip, type Day, type ParseResult } from '../api';

export default function AddItem() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [parseUrl, setParseUrl] = useState('');
  const [parsing, setParsing] = useState(false);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [parseError, setParseError] = useState('');

  // Form state
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [type, setType] = useState('hotel');
  const [price, setPrice] = useState('');
  const [date, setDate] = useState('');
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
    // Auto-detect clipboard link
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

      // Pre-fill form
      if (result.title) setTitle(result.title);
      if (result.type) setType(result.type);
      if (result.price) setPrice(String(result.price));
      if (result.date) setDate(result.date);
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
      date: date || null,
      source: source as any,
      sourceUrl: sourceUrl || null,
      imageUrl: imageUrl || null,
      note: note.trim(),
    });

    navigate(`/trip/${id}`);
  }

  if (!trip) return <div className="loading">加载中...</div>;

  return (
    <div className="page">
      <header className="header">
        <button className="btn-sm" onClick={() => navigate(`/trip/${id}`)}>← 返回</button>
        <h3>添加项目</h3>
      </header>

      <div className="container">
        {/* Parse section */}
        <div className="parse-section">
          <p className="parse-hint">粘贴携程/马蜂窝链接，自动提取信息</p>
          <div className="parse-input-row">
            <input
              type="url"
              placeholder="https://..."
              value={parseUrl}
              onChange={e => setParseUrl(e.target.value)}
            />
            <button onClick={handleParse} disabled={parsing} className="btn-primary btn-sm">
              {parsing ? '解析中...' : '解析'}
            </button>
          </div>
          {parseError && <div className="error">{parseError}</div>}
          {parseResult && (
            <div className={`parse-result confidence-${parseResult.confidence}`}>
              {parseResult.confidence === 'low' ? '⚠️ 信息不完整，请手动补充' : '✅ 已自动识别'}
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit} className="item-form">
          <div className="form-group">
            <label>项目名称 *</label>
            <input value={title} onChange={e => setTitle(e.target.value)} required />
          </div>

          <div className="form-group">
            <label>副标题（房型/票种）</label>
            <input value={subtitle} onChange={e => setSubtitle(e.target.value)} />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>类型</label>
              <select value={type} onChange={e => setType(e.target.value)}>
                <option value="hotel">🏨 酒店</option>
                <option value="attraction">🎫 景点/门票</option>
                <option value="traffic">🚄 交通</option>
                <option value="meal">🍽 餐饮</option>
                <option value="custom">📌 其他</option>
              </select>
            </div>
            <div className="form-group">
              <label>价格 ¥</label>
              <input type="number" value={price} onChange={e => setPrice(e.target.value)} placeholder="0" />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>日期</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} />
            </div>
            <div className="form-group">
              <label>归入哪一天</label>
              <select value={dayId} onChange={e => setDayId(e.target.value)} required>
                <option value="">选择...</option>
                {trip.days.map((d: Day) => (
                  <option key={d.id} value={d.id}>
                    {d.label} ({new Date(d.date).toLocaleDateString('zh-CN')})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-group">
            <label>来源平台</label>
            <select value={source} onChange={e => setSource(e.target.value)}>
              <option value="ctrip">携程</option>
              <option value="mafengwo">马蜂窝</option>
              <option value="fliggy">飞猪</option>
              <option value="meituan">美团</option>
              <option value="qunar">去哪儿</option>
              <option value="manual">手动添加</option>
            </select>
          </div>

          <div className="form-group">
            <label>商品链接</label>
            <input value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} placeholder="https://..." />
          </div>

          <div className="form-group">
            <label>图片链接</label>
            <input value={imageUrl} onChange={e => setImageUrl(e.target.value)} placeholder="https://..." />
          </div>

          <div className="form-group">
            <label>备注</label>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} />
          </div>

          <button type="submit" className="btn-primary btn-full">确认添加</button>
        </form>
      </div>
    </div>
  );
}
