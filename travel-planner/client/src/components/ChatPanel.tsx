import { useState, useRef, useEffect } from 'react';
import { streamAIChat, aiApplyChanges, type Trip, type SSEEvent } from '../api';
import { useT } from '../i18n';

interface ChatMessage {
  role: 'user' | 'ai';
  text: string;
}

export default function ChatPanel({ trip, onTripUpdate, onClose }: {
  trip: Trip;
  onTripUpdate: (trip: Trip) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [chatting, setChatting] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);

  // Restore saved messages on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`chat_${trip.id}`);
      if (saved) setMessages(JSON.parse(saved));
      else {
        const days = trip.days.map(d => `${d.label}: ` + d.items.map(i => i.title).join(', ')).join('\n');
        setMessages([{ role: 'ai', text: `${t('tripDetail.chat')}:\n${days}` }]);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist messages
  useEffect(() => {
    if (messages.length > 0) {
      try { localStorage.setItem(`chat_${trip.id}`, JSON.stringify(messages)); } catch {}
    }
  }, [messages, trip.id]);

  // Auto-scroll
  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages]);

  async function handleSend() {
    if (!input.trim() || chatting) return;
    const msg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: msg }]);
    setChatting(true);

    let fullReply = '';
    streamAIChat(
      trip.id, msg,
      (e: SSEEvent) => {
        if (e.content) {
          fullReply += e.content;
          setMessages(prev => {
            const copy = [...prev];
            const last = copy[copy.length - 1];
            if (last?.role === 'ai') last.text = fullReply;
            else copy.push({ role: 'ai', text: fullReply });
            return copy;
          });
        }
      },
      async (tripData, changes) => {
        try {
          const updated = await aiApplyChanges(trip.id, tripData);
          onTripUpdate(updated);
          setMessages(prev => [...prev, { role: 'ai', text: (changes || t('tripDetail.applied')) }]);
        } catch (err: any) {
          setMessages(prev => [...prev, { role: 'ai', text: t('common.failed') + ': ' + err.message }]);
        }
        setChatting(false);
      },
      (err: Error) => {
        setMessages(prev => [...prev, { role: 'ai', text: t('common.error') + ': ' + err.message }]);
        setChatting(false);
      },
    );
  }

  return (
    <div className="chat-panel">
      <div className="chat-panel-header">
        {t('tripDetail.chat')}
        <button className="chat-panel-close" onClick={onClose}>x</button>
      </div>
      <div className="chat-messages" ref={chatRef}>
        {messages.map((msg, i) => (
          <div key={i} className={`chat-msg ${msg.role}`}>{msg.text}</div>
        ))}
        {chatting && <div style={{ color: '#9b9a97', fontSize: 12 }}>{t('tripDetail.thinking')}</div>}
      </div>
      <div className="chat-input-row">
        <input value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSend(); }}
          placeholder={t('tripDetail.chatPlaceholder')}
        />
        <button className="btn btn-sm" onClick={handleSend} disabled={chatting || !input.trim()}>{t('common.send')}</button>
      </div>
    </div>
  );
}
