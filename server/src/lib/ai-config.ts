export const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';
export const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || '';
export const MODEL = 'deepseek-v4-flash';

export function inferTypeFromText(text: string): string {
  const t = text.toLowerCase();
  if (t.includes('酒店') || t.includes('hotel') || t.includes('住宿') || t.includes('民宿') || t.includes('住')) return 'hotel';
  if (t.includes('门票') || t.includes('景点') || t.includes('ticket') || t.includes('景区') || t.includes('公园') || t.includes('游') || t.includes('玩')) return 'attraction';
  if (t.includes('火车') || t.includes('高铁') || t.includes('动车') || t.includes('飞机') || t.includes('航班') || t.includes('traffic') || t.includes('车')) return 'traffic';
  if (t.includes('餐厅') || t.includes('美食') || t.includes('自助') || t.includes('火锅') || t.includes('餐') || t.includes('饭') || t.includes('食') || t.includes('meal') || t.includes('吃')) return 'meal';
  return 'custom';
}

export function deepSeek(messages: { role: string; content: string }[], maxTokens = 512, temperature = 0.1) {
  return fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${DEEPSEEK_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      max_tokens: maxTokens,
      temperature,
    }),
  });
}
