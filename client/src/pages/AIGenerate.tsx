import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { streamAIGenerate, streamAIChat, aiApplyChanges, type SSEEvent, type Trip } from '../api';
import { useT } from '../i18n';

export default function AIGenerate({ onClose }: { onClose?: () => void }) {
  const { t } = useT();
  const navigate = useNavigate();
  const [step, setStep] = useState<'input' | 'generating' | 'review'>('input');
  const [prompt, setPrompt] = useState('');
  const [streamText, setStreamText] = useState('');
  const [trip, setTrip] = useState<Trip | null>(null);
  const [error, setError] = useState('');
  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'ai'; text: string }[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatting, setChatting] = useState(false);
  const [applying, setApplying] = useState(false);
  const streamRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (streamRef.current) {
      streamRef.current.scrollTop = streamRef.current.scrollHeight;
    }
  }, [streamText, chatMessages]);

  async function handleGenerate() {
    if (!prompt.trim()) return;
    setStep('generating');
    setStreamText('');
    setError('');
    setTrip(null);

    let fullText = '';
    controllerRef.current = streamAIGenerate(
      prompt.trim(),
      (e: SSEEvent) => {
        if (e.content) {
          fullText += e.content;
          setStreamText(fullText);
        } else if (e.trip) {
          setTrip(e.trip);
          setStep('review');
          setChatMessages([{ role: 'ai', text: fullText.split('```json')[0] || fullText }]);
        } else if (e.error) {
          setError(e.error);
          setStep('input');
        }
      },
      (err: Error) => {
        setError(err.message);
        setStep('input');
      },
    );
  }

  async function handleChat() {
    if (!chatInput.trim() || !trip || chatting) return;
    const msg = chatInput.trim();
    setChatInput('');
    setChatMessages(prev => [...prev, { role: 'user', text: msg }]);
    setChatting(true);

    let fullReply = '';
    controllerRef.current = streamAIChat(
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
          setError(e.error);
          setChatMessages(prev => [...prev, { role: 'ai', text: t('common.error') + ': ' + e.error }]);
        } else if (e.reply) {
          setChatMessages(prev => [...prev, { role: 'ai', text: e.reply || '' }]);
        }
      },
      async (tripData, changes) => {
        try {
          const updated = await aiApplyChanges(trip.id, tripData);
          setTrip(updated);
          setChatMessages(prev => [...prev, { role: 'ai', text: (changes || t('tripDetail.applied')) + '\n\n' + t('ai.tripUpdated') }]);
        } catch (err: any) {
          setError(err.message);
        } finally {
          setChatting(false);
        }
      },
      (err: Error) => {
        setError(err.message);
        setChatMessages(prev => [...prev, { role: 'ai', text: t('common.error') + ': ' + err.message }]);
        setChatting(false);
      },
    );
  }

  async function handleApply(tripData: any) {
    if (!trip) return;
    setApplying(true);
    try {
      const updated = await aiApplyChanges(trip.id, tripData);
      setTrip(updated);
      setChatMessages(prev => [...prev, { role: 'ai', text: t('ai.changesApplied') }]);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setApplying(false);
    }
  }

  async function handleFinish() {
    const lastAIMsg = [...chatMessages].reverse().find(m => m.role === 'ai');
    if (lastAIMsg) {
      const jsonMatch = lastAIMsg.text.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        try {
          const data = JSON.parse(jsonMatch[1]);
          if (data.trip) {
            await aiApplyChanges(trip!.id, data.trip);
          }
        } catch {}
      }
    }
    navigate(`/trip/${trip!.id}`);
    onClose?.();
  }

  function handleCancel() {
    controllerRef.current?.abort();
    if (onClose) {
      onClose();
    } else if (trip) {
      navigate(`/trip/${trip.id}`);
    } else {
      navigate('/');
    }
  }

  return (
    <div className="page">
      <div className="header">
        <button className="btn btn-sm" onClick={handleCancel}>{t('common.back')}</button>
        <h3>{t('ai.title')}</h3>
      </div>

      {step === 'input' && (
        <div className="section">
          <div className="section-hint">{t('ai.description')}</div>
          <textarea
            placeholder={t('ai.placeholder')}
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            rows={5}
            style={{ width: '100%', resize: 'vertical', marginBottom: 12 }}
            autoFocus
          />
          {error && <div className="error">{error}</div>}
          <button className="btn btn-full" onClick={handleGenerate} disabled={!prompt.trim()}>
            {t('ai.generate')}
          </button>
        </div>
      )}

      {step === 'generating' && (
        <div className="section">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <div className="spinner" />
            <span style={{ color: '#9b9a97' }}>{t('ai.planning')}</span>
          </div>
          <div ref={streamRef} className="stream-box">
            {streamText || t('ai.waiting')}
          </div>
          <button className="btn btn-sm" style={{ marginTop: 12 }} onClick={handleCancel}>{t('common.cancel')}</button>
        </div>
      )}

      {step === 'review' && trip && (
        <>
          <div className="section">
            <div className="parse-result confidence-high">
              {t('ai.generated')}{trip.title}
            </div>

            <div style={{ fontSize: 13, color: '#9b9a97', marginBottom: 16, marginTop: 4 }}>
              {trip.destination} &middot; {trip.days.length} {t('import.parsedDays')} &middot; {trip.days.reduce((n, d) => n + d.items.length, 0)} {t('tripDetail.items')} &middot;
              {t('tripDetail.budget')} {(trip.days.reduce((n, d) => n + d.items.reduce((s, i) => s + (i.price || 0), 0), 0)).toLocaleString()}
            </div>

            <div className="preview-days">
              {trip.days.map(day => (
                <div key={day.id} className="preview-day">
                  <div className="preview-day-header">
                    {day.label} &mdash; {new Date(day.date).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}
                  </div>
                  {day.items.map(item => (
                    <div key={item.id} className="preview-item">
                      {t(`type.${item.type}`)}: {item.title}
                      {item.price ? <span style={{ color: '#e03e2d', marginLeft: 8 }}>{item.price.toLocaleString()}</span> : null}
                    </div>
                  ))}
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button className="btn" onClick={handleFinish}>{t('ai.confirm')}</button>
              <button className="btn btn-sm btn-secondary" onClick={handleCancel}>{t('common.cancel')}</button>
            </div>
          </div>

          <div className="section">
            <h4 style={{ marginBottom: 8, fontSize: 15, fontWeight: 600 }}>{t('ai.chatTitle')}</h4>
            <div
              ref={streamRef}
              style={{
                border: '1px solid #e9e9e7',
                borderRadius: 6,
                padding: 12,
                maxHeight: 300,
                overflow: 'auto',
                marginBottom: 8,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              {chatMessages.map((msg, i) => (
                <div key={i} className={`chat-msg ${msg.role}`}>
                  {msg.text}
                  {msg.role === 'ai' && (() => {
                    const jsonMatch = msg.text.match(/```json\s*([\s\S]*?)\s*```/);
                    if (jsonMatch) {
                      try {
                        const data = JSON.parse(jsonMatch[1]);
                        if (data.trip) {
                          return (
                            <button
                              className="btn btn-sm"
                              style={{ marginTop: 8, display: 'block' }}
                              onClick={() => handleApply(data.trip)}
                              disabled={applying}
                            >
                              {applying ? t('ai.applying') : t('ai.applyChanges')}
                            </button>
                          );
                        }
                      } catch {}
                    }
                    return null;
                  })()}
                </div>
              ))}
              {chatting && (
                <div style={{ color: '#9b9a97', fontSize: 13 }}>{t('ai.thinking')}</div>
              )}
            </div>
            <div className="parse-input-row">
              <input
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleChat(); }}
                placeholder={t('ai.chatPlaceholder')}
              />
              <button className="btn btn-sm" onClick={handleChat} disabled={chatting || !chatInput.trim()}>
                {t('common.send')}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
