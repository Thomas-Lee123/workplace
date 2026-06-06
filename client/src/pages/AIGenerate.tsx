import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { streamAIGenerate, streamAIChat, aiApplyChanges, type SSEEvent, type Trip } from '../api';

export default function AIGenerate() {
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
          setChatMessages(prev => [...prev, { role: 'ai', text: '抱歉，出错了：' + e.error }]);
        } else if (e.reply) {
          setChatMessages(prev => [...prev, { role: 'ai', text: e.reply || '' }]);
        }
      },
      async (tripData, changes) => {
        try {
          const updated = await aiApplyChanges(trip.id, tripData);
          setTrip(updated);
          setChatMessages(prev => [...prev, { role: 'ai', text: (changes || '已应用修改') + '\n\n行程已更新。' }]);
        } catch (err: any) {
          setError(err.message);
        } finally {
          setChatting(false);
        }
      },
      (err: Error) => {
        setError(err.message);
        setChatMessages(prev => [...prev, { role: 'ai', text: '抱歉，出错了：' + err.message }]);
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
      setChatMessages(prev => [...prev, { role: 'ai', text: '已应用修改到行程！' }]);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setApplying(false);
    }
  }

  async function handleFinish() {
    // Parse the last AI message for any JSON trip data that wasn't applied
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
  }

  function handleCancel() {
    controllerRef.current?.abort();
    if (trip) {
      navigate(`/trip/${trip.id}`);
    } else {
      navigate('/');
    }
  }

  return (
    <div className="page">
      <header className="header">
        <button className="btn-sm" onClick={handleCancel}>← 返回</button>
        <h3>AI 生成行程</h3>
      </header>

      <div className="container">
        {/* Step 1: Input prompt */}
        {step === 'input' && (
          <div className="parse-section" style={{ marginTop: 16 }}>
            <p style={{ fontSize: 14, color: '#666', marginBottom: 12 }}>
              用自然语言描述你的旅行计划，AI 会实时生成完整行程
            </p>
            <textarea
              placeholder="例如：我想五一去成都玩3天，预算3000以内，喜欢吃辣的，想去大熊猫基地、宽窄巷子、都江堰，住春熙路附近"
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              rows={5}
              style={{ width: '100%', resize: 'vertical', marginBottom: 12 }}
              autoFocus
            />
            {error && <div className="error">{error}</div>}
            <button className="btn-primary btn-full" onClick={handleGenerate} disabled={!prompt.trim()}>
              开始生成
            </button>
          </div>
        )}

        {/* Step 2: Streaming generation */}
        {step === 'generating' && (
          <div className="parse-section" style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <div className="spinner" />
              <span style={{ color: '#1677ff', fontWeight: 500 }}>AI 正在规划行程...</span>
            </div>
            <div
              ref={streamRef}
              style={{
                background: '#f8f9fa',
                borderRadius: 8,
                padding: 16,
                maxHeight: 400,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                fontSize: 14,
                lineHeight: 1.8,
              }}
            >
              {streamText || '等待 AI 响应...'}
            </div>
            <button className="btn-sm" style={{ marginTop: 12 }} onClick={handleCancel}>取消</button>
          </div>
        )}

        {/* Step 3: Review & Chat */}
        {step === 'review' && trip && (
          <>
            {/* Trip preview */}
            <div className="parse-section" style={{ marginTop: 16 }}>
              <div className="parse-result confidence-high" style={{ marginBottom: 12 }}>
                ✅ 行程已生成：{trip.title}
              </div>

              <div style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>
                {trip.destination} | {trip.days.length}天 | 共 {trip.days.reduce((n, d) => n + d.items.length, 0)} 个项目 |
                预算 ¥{trip.days.reduce((n, d) => n + d.items.reduce((s, i) => s + (i.price || 0), 0), 0).toLocaleString()}
              </div>

              {trip.days.map(day => (
                <div key={day.id} style={{ marginBottom: 8 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
                    {day.label} — {new Date(day.date).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}
                  </div>
                  {day.items.map(item => (
                    <div key={item.id} style={{ fontSize: 13, padding: '2px 0 2px 12px', color: '#666' }}>
                      {({ hotel: '🏨', attraction: '🎫', traffic: '🚄', meal: '🍽', custom: '📌' } as any)[item.type] || '📌'}{' '}
                      {item.title}
                      {item.price ? <span style={{ color: '#ff4d4f', marginLeft: 8 }}>¥{item.price.toLocaleString()}</span> : null}
                    </div>
                  ))}
                </div>
              ))}

              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button className="btn-primary" onClick={handleFinish}>确认，查看行程</button>
                <button className="btn-sm" onClick={handleCancel}>取消</button>
              </div>
            </div>

            {/* Chat section */}
            <div className="parse-section">
              <h4 style={{ marginBottom: 8, fontSize: 15 }}>和 AI 讨论修改</h4>
              <div
                ref={streamRef}
                style={{
                  background: '#f8f9fa',
                  borderRadius: 8,
                  padding: 12,
                  maxHeight: 300,
                  overflow: 'auto',
                  marginBottom: 8,
                }}
              >
                {chatMessages.map((msg, i) => (
                  <div key={i} style={{
                    marginBottom: 8,
                    textAlign: msg.role === 'user' ? 'right' : 'left',
                  }}>
                    <div style={{
                      display: 'inline-block',
                      background: msg.role === 'user' ? '#1677ff' : '#fff',
                      color: msg.role === 'user' ? '#fff' : '#333',
                      padding: '6px 12px',
                      borderRadius: 12,
                      maxWidth: '85%',
                      fontSize: 14,
                      whiteSpace: 'pre-wrap',
                      textAlign: 'left',
                      boxShadow: msg.role === 'ai' ? '0 1px 3px rgba(0,0,0,.1)' : 'none',
                    }}>
                      {msg.text}
                      {msg.role === 'ai' && (() => {
                        const jsonMatch = msg.text.match(/```json\s*([\s\S]*?)\s*```/);
                        if (jsonMatch) {
                          try {
                            const data = JSON.parse(jsonMatch[1]);
                            if (data.trip) {
                              return (
                                <button
                                  className="btn-primary btn-sm"
                                  style={{ marginTop: 8, display: 'block' }}
                                  onClick={() => handleApply(data.trip)}
                                  disabled={applying}
                                >
                                  {applying ? '应用中...' : '应用此修改'}
                                </button>
                              );
                            }
                          } catch {}
                        }
                        return null;
                      })()}
                    </div>
                  </div>
                ))}
                {chatting && (
                  <div style={{ color: '#999', fontSize: 13 }}>AI 思考中...</div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleChat(); }}
                  placeholder="例如：把第二天酒店换成便宜点的、增加一个第三天去迪士尼..."
                  style={{ flex: 1 }}
                />
                <button className="btn-primary btn-sm" onClick={handleChat} disabled={chatting || !chatInput.trim()}>
                  发送
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
