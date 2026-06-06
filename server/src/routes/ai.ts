import { Router, Response } from 'express';
import { z } from 'zod';
import { auth, AuthRequest } from '../middleware/auth';
import prisma from '../lib/prisma';

const router = Router();
router.use(auth);

const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || '';
const MODEL = 'deepseek-v4-flash';

interface StreamChunk {
  content: string;
  done: boolean;
}

async function* streamDeepSeek(messages: { role: string; content: string }[]): AsyncGenerator<StreamChunk> {
  const res = await fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${DEEPSEEK_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      stream: true,
      max_tokens: 16384,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error?.message || `AI 请求失败 (${res.status})`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') {
        yield { content: '', done: true };
        return;
      }
      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta || {};
        const content = delta.content || delta.reasoning_content || '';
        if (content) {
          yield { content, done: false };
        }
      } catch {}
    }
  }

  yield { content: '', done: true };
}

function sseHeaders(res: Response) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
}

function sendSSE(res: Response, event: string, data: any) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// ==================== GENERATE TRIP (STREAMING) ====================

const generateSchema = z.object({
  prompt: z.string().min(1, '请输入行程描述'),
});

const SYSTEM_GENERATE = `你是旅行行程规划助手。根据用户描述生成详细旅行行程。

你必须先在前面用自然语言介绍行程亮点和每日安排概览，然后在最后附上一个 JSON 代码块（\`\`\`json ... \`\`\`），JSON 格式如下：
{
  "title": "行程名称",
  "destination": "目的地",
  "startDate": "YYYY-MM-DD",
  "endDate": "YYYY-MM-DD",
  "days": [
    {
      "label": "第1天",
      "date": "YYYY-MM-DD",
      "items": [
        {
          "type": "hotel|attraction|traffic|meal|custom",
          "title": "项目名称",
          "subtitle": "补充说明",
          "price": 数字,
          "note": "备注",
          "sourceUrl": ""
        }
      ]
    }
  ]
}

规则：
1. 如果用户没指定日期，假设从最近一个周末开始
2. 每天2-5个项目，不要太紧凑
3. 价格根据常识估算（人民币），不确定填0
4. type: hotel(酒店)、attraction(景点/门票)、traffic(交通)、meal(餐饮)、custom(其他)
5. 先写文字介绍，最后给JSON`;

router.post('/generate-stream', async (req: AuthRequest, res: Response) => {
  const result = generateSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: result.error.issues[0].message });
    return;
  }

  sseHeaders(res);
  let fullContent = '';

  try {
    for await (const chunk of streamDeepSeek([
      { role: 'system', content: SYSTEM_GENERATE },
      { role: 'user', content: result.data.prompt },
    ])) {
      if (chunk.content) {
        fullContent += chunk.content;
        sendSSE(res, 'text', { content: chunk.content });
      }
    }

    // Parse JSON from response
    const jsonMatch = fullContent.match(/```json\s*([\s\S]*?)\s*```/);
    if (!jsonMatch) {
      sendSSE(res, 'error', { error: 'AI 返回格式异常，请重试' });
      res.end();
      return;
    }

    const tripData = JSON.parse(jsonMatch[1]);

    // Create trip in DB
    const trip = await prisma.trip.create({
      data: {
        userId: req.userId!,
        title: tripData.title || 'AI 生成的行程',
        destination: tripData.destination || '',
        startDate: new Date(tripData.startDate),
        endDate: new Date(tripData.endDate),
        days: {
          create: (tripData.days as any[]).map((day: any, di: number) => ({
            date: new Date(day.date),
            label: day.label || `第${di + 1}天`,
            sortOrder: di,
            items: {
              create: (day.items as any[]).map((item: any, ii: number) => ({
                type: item.type || 'custom',
                title: item.title || '',
                subtitle: item.subtitle || '',
                sortOrder: ii,
                source: 'manual',
                sourceUrl: item.sourceUrl || null,
                price: typeof item.price === 'number' ? item.price : null,
                note: item.note || '',
              })),
            },
          })),
        },
      },
      include: {
        days: { include: { items: true }, orderBy: { sortOrder: 'asc' } },
      },
    });

    sendSSE(res, 'done', { trip });
    res.end();
  } catch (err: any) {
    if (err instanceof SyntaxError) {
      sendSSE(res, 'error', { error: 'AI 返回格式异常，请重试' });
    } else {
      sendSSE(res, 'error', { error: err.message || '生成失败' });
    }
    res.end();
  }
});

// ==================== CHAT ABOUT TRIP (STREAMING) ====================

const chatSchema = z.object({
  tripId: z.string().min(1),
  message: z.string().min(1),
});

const SYSTEM_CHAT = `你是旅行行程助手。用户已经有了一个行程，现在想和你讨论修改。

你需要理解用户的修改需求，然后：
1. 用自然语言回复用户，解释你将会如何修改
2. 在最后给出一个 JSON 代码块（\`\`\`json ... \`\`\`），包含修改后的完整行程数据

JSON 格式：
{
  "reply": "你的回复（自然语言）",
  "changes": "修改说明",
  "trip": {
    "title": "...",
    "destination": "...",
    "startDate": "YYYY-MM-DD",
    "endDate": "YYYY-MM-DD",
    "days": [
      {
        "label": "第N天",
        "date": "YYYY-MM-DD",
        "items": [
          {
            "type": "hotel|attraction|traffic|meal|custom",
            "title": "",
            "subtitle": "",
            "price": 数字,
            "note": "",
            "sourceUrl": ""
          }
        ]
      }
    ]
  }
}`;

router.post('/chat-stream', async (req: AuthRequest, res: Response) => {
  const result = chatSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: result.error.issues[0].message });
    return;
  }

  const { tripId, message } = result.data;

  // Load current trip
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, userId: req.userId },
    include: { days: { include: { items: true }, orderBy: { sortOrder: 'asc' } } },
  });

  if (!trip) {
    res.status(404).json({ error: '行程不存在' });
    return;
  }

  // Build trip summary for context
  const tripSummary = JSON.stringify({
    title: trip.title,
    destination: trip.destination,
    startDate: trip.startDate.toISOString().split('T')[0],
    endDate: trip.endDate.toISOString().split('T')[0],
    days: trip.days.map(d => ({
      label: d.label,
      date: d.date.toISOString().split('T')[0],
      items: d.items.map(i => ({
        type: i.type,
        title: i.title,
        subtitle: i.subtitle,
        price: i.price,
        note: i.note,
      })),
    })),
  }, null, 2);

  sseHeaders(res);
  let fullContent = '';

  try {
    for await (const chunk of streamDeepSeek([
      { role: 'system', content: SYSTEM_CHAT },
      { role: 'user', content: `当前行程：\n${tripSummary}\n\n用户要求：${message}` },
    ])) {
      if (chunk.content) {
        fullContent += chunk.content;
        sendSSE(res, 'text', { content: chunk.content });
      }
    }

    // Parse JSON from response
    const jsonMatch = fullContent.match(/```json\s*([\s\S]*?)\s*```/);
    if (!jsonMatch) {
      sendSSE(res, 'error', { error: 'AI 返回格式异常' });
      res.end();
      return;
    }

    const aiResponse = JSON.parse(jsonMatch[1]);
    sendSSE(res, 'done', {
      reply: aiResponse.reply || '',
      changes: aiResponse.changes || '',
      tripData: aiResponse.trip || null,
    });
    res.end();
  } catch (err: any) {
    if (err instanceof SyntaxError) {
      sendSSE(res, 'error', { error: 'AI 返回格式异常，请重试' });
    } else {
      sendSSE(res, 'error', { error: err.message || '对话失败' });
    }
    res.end();
  }
});

// ==================== APPLY AI CHANGES TO TRIP ====================

const applySchema = z.object({
  tripId: z.string().min(1),
  tripData: z.object({
    title: z.string().optional(),
    destination: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    days: z.array(z.object({
      label: z.string(),
      date: z.string(),
      items: z.array(z.object({
        type: z.string(),
        title: z.string(),
        subtitle: z.string().optional(),
        price: z.number().nullable().optional(),
        note: z.string().optional(),
        sourceUrl: z.string().nullable().optional(),
      })),
    })),
  }),
});

router.post('/apply', async (req: AuthRequest, res: Response) => {
  const result = applySchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: result.error.issues[0].message });
    return;
  }

  const { tripId, tripData } = result.data;

  // Verify ownership
  const existing = await prisma.trip.findFirst({
    where: { id: tripId, userId: req.userId },
  });
  if (!existing) {
    res.status(404).json({ error: '行程不存在' });
    return;
  }

  // Delete old days (cascade deletes items)
  await prisma.day.deleteMany({ where: { tripId } });

  // Update trip + recreate days/items
  const updated = await prisma.trip.update({
    where: { id: tripId },
    data: {
      ...(tripData.title ? { title: tripData.title } : {}),
      ...(tripData.destination ? { destination: tripData.destination } : {}),
      ...(tripData.startDate ? { startDate: new Date(tripData.startDate) } : {}),
      ...(tripData.endDate ? { endDate: new Date(tripData.endDate) } : {}),
      days: {
        create: tripData.days.map((day: any, di: number) => ({
          date: new Date(day.date),
          label: day.label || `第${di + 1}天`,
          sortOrder: di,
          items: {
            create: (day.items as any[]).map((item: any, ii: number) => ({
              type: item.type || 'custom',
              title: item.title || '',
              subtitle: item.subtitle || '',
              sortOrder: ii,
              source: 'manual',
              sourceUrl: item.sourceUrl || null,
              price: typeof item.price === 'number' ? item.price : null,
              note: item.note || '',
            })),
          },
        })),
      },
    },
    include: {
      days: { include: { items: true }, orderBy: { sortOrder: 'asc' } },
    },
  });

  res.json(updated);
});

// ==================== PARSE TEXT TO TRIP ====================

const parseSchema = z.object({
  text: z.string().min(1),
  title: z.string().optional(),
  destination: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

router.post('/parse', async (req: AuthRequest, res: Response) => {
  const result = parseSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: result.error.issues[0].message });
    return;
  }

  const { text, title, destination, startDate, endDate } = result.data;
  const parts = ['请从以下文本中提取旅行行程信息。'];
  if (title) parts.push(`行程名称: ${title}`);
  if (destination) parts.push(`目的地: ${destination}`);
  if (startDate) parts.push(`出发日期: ${startDate}`);
  if (endDate) parts.push(`结束日期: ${endDate}`);
  parts.push(`\n文本:\n${text.slice(0, 8000)}`);

  try {
    let fullContent = '';
    for await (const chunk of streamDeepSeek([
      { role: 'system', content: SYSTEM_GENERATE },
      { role: 'user', content: parts.join('\n') },
    ])) {
      fullContent += chunk.content;
    }

    const jsonMatch = fullContent.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      res.json(JSON.parse(jsonMatch[1]));
    } else {
      res.status(422).json({ error: 'AI 无法识别该文本中的行程信息' });
    }
  } catch (err: any) {
    res.status(422).json({ error: err.message || 'AI 解析失败' });
  }
});

// ==================== ANALYZE ITEM URL ====================

function extractImageUrl(html: string, baseUrl: string): string | null {
  // Resolve relative URL to absolute
  const resolve = (src: string) => {
    if (!src) return null;
    if (src.startsWith('data:')) return null; // skip data URIs
    if (src.startsWith('http')) return src;
    try {
      const u = new URL(baseUrl);
      return new URL(src, u.origin).href;
    } catch { return null; }
  };

  // Strategy 1: og:image
  let m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  if (m) return resolve(m[1]);

  // Strategy 2: twitter:image
  m = html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i);
  if (m) return resolve(m[1]);

  // Strategy 3: itemProp image (schema.org)
  m = html.match(/<meta[^>]+itemprop=["']image["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+itemprop=["']image["']/i);
  if (m) return resolve(m[1]);

  // Strategy 4: link image_src
  m = html.match(/<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i)
    || html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']image_src["']/i);
  if (m) return resolve(m[1]);

  // Strategy 5: first large image in body (skip icons, logos, avatars)
  const bodyMatch = html.match(/<body[\s\S]*?<\/body>/i);
  const body = bodyMatch ? bodyMatch[0] : html;
  const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let img: RegExpExecArray | null;
  while ((img = imgRegex.exec(body)) !== null) {
    const src = img[1];
    // Skip small/icon images
    if (/icon|logo|avatar|thumb|banner|ad|qr|wechat|wx|alipay|80x80|60x60|40x40|32x32|16x16/i.test(src)) continue;
    const resolved = resolve(src);
    if (resolved) return resolved;
  }

  return null;
}

const analyzeSchema = z.object({
  url: z.string().url('请提供有效链接'),
  tripId: z.string().min(1),
});

const SYSTEM_ANALYZE = `你是旅行规划助手。用户正在规划行程，粘贴了一个链接。你需要分析这个链接的内容，并给出建议。

请返回JSON：
{
  "title": "项目名称（从页面标题或URL中提取具体名称，如'北京希尔顿'、'故宫博物院'，必须返回真实名称不能为空）",
  "type": "hotel|attraction|traffic|meal|custom",
  "price": 数字或null,
  "pros": ["优点1", "优点2", "优点3"],
  "cons": ["缺点1", "缺点2"],
  "distanceAdvice": "结合用户行程中已有项目的位置，分析距离是否合理，给出具体建议（如：该酒店距离你Day1的景点仅2km，交通方便；或：该景点距离其他景点较远，建议调整顺序）"
}

规则：
1. title必须从页面标题、正文或URL路径中提取真实名称，绝不能返回空字符串或"未知"
2. 如果页面内容无法获取，尝试从URL路径和域名中推断名称（如/hotel/beijing-hilton → 北京希尔顿）
3. pros和cons各2-3条，要具体，不要泛泛而谈
4. distanceAdvice要结合用户行程中的具体地点来分析距离
5. 如果能从链接提取到价格，填写price
6. 根据链接内容推断type`;

router.post('/analyze-item', async (req: AuthRequest, res: Response) => {
  const result = analyzeSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: result.error.issues[0].message });
    return;
  }

  const { url, tripId } = result.data;

  // Load trip with all items for context
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, userId: req.userId },
    include: { days: { include: { items: true }, orderBy: { sortOrder: 'asc' } } },
  });

  if (!trip) {
    res.status(404).json({ error: '行程不存在' });
    return;
  }

  // Build itinerary summary
  const itemsList = trip.days.map(d => {
    const itemNames = d.items.map(i => `${i.title}(${i.type})`).join('、');
    return `${d.label} (${d.date.toISOString().split('T')[0]}): ${itemNames || '暂无项目'}`;
  }).join('\n');

  const itinerary = `目的地: ${trip.destination}
日期: ${trip.startDate.toISOString().split('T')[0]} ~ ${trip.endDate.toISOString().split('T')[0]}
已有行程:
${itemsList}`;

  // Try to fetch URL content
  let pageText = '';
  let pageTitle = '';
  let extractedImageUrl = '';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const html = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timer);
    const raw = await html.text();
    // Extract title
    const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch) pageTitle = titleMatch[1].trim().replace(/\s+/g, ' ');
    // Extract meta description
    const descMatch = raw.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
      || raw.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
    let metaDesc = descMatch ? descMatch[1].trim() : '';
    // Strip HTML for body text
    const bodyText = raw
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#x?[0-9a-f]+;/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 2000);
    pageText = `标题: ${pageTitle || '未知'}\n描述: ${metaDesc || '无'}\n正文: ${bodyText}`;
    // Extract main image with multiple strategies
    extractedImageUrl = extractImageUrl(raw, url) || '';
  } catch {
    pageText = '无法获取页面内容';
  }

  try {
    let fullContent = '';
    for await (const chunk of streamDeepSeek([
      { role: 'system', content: SYSTEM_ANALYZE },
      { role: 'user', content: `链接: ${url}\n${pageText ? `页面信息:\n${pageText}` : '注意：无法获取页面内容，请从URL中推断项目名称和类型'}\n\n用户行程:\n${itinerary}\n\n请从以上信息中提取项目名称（特别是页面标题中的名称），并从URL域名判断平台。` },
    ])) {
      fullContent += chunk.content;
    }

    const jsonMatch = fullContent.match(/```json\s*([\s\S]*?)\s*```/) || fullContent.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
      if (extractedImageUrl && !parsed.imageUrl) {
        parsed.imageUrl = extractedImageUrl;
      }
      res.json(parsed);
    } else {
      res.status(422).json({ error: 'AI 无法分析该链接，请手动填写' });
    }
  } catch (err: any) {
    if (err instanceof SyntaxError) {
      res.status(422).json({ error: 'AI 分析失败，请重试' });
    } else {
      res.status(500).json({ error: err.message || '分析失败' });
    }
  }
});

// ==================== PARSE GROUP TOUR URL ====================

const parseUrlSchema = z.object({
  url: z.string().url('请提供有效链接'),
});

const SYSTEM_PARSE_URL = `你是旅行行程规划助手。用户提供了一个跟团游或自由行产品的网页链接，请将该行程转换为自由行格式。

请分析网页内容并提取完整的行程安排，返回JSON：
{
  "title": "行程名称",
  "destination": "目的地城市",
  "startDate": "YYYY-MM-DD（如果是N天行程，请从最近一个周六开始）",
  "endDate": "YYYY-MM-DD",
  "days": [
    {
      "label": "第1天",
      "date": "YYYY-MM-DD",
      "items": [
        {
          "type": "hotel|attraction|traffic|meal|custom",
          "title": "项目名称",
          "subtitle": "补充说明",
          "price": 数字或null,
          "note": "备注",
          "sourceUrl": ""
        }
      ]
    }
  ]
}

规则：
1. 仔细提取网页中每天的行程安排（景点、酒店、餐饮等）
2. 交通项目（如机票、火车、接送）type设为traffic
3. 酒店住宿type设为hotel，景点type设为attraction
4. 如果是"N天N晚"格式，天数=天数+1（如5天4晚→5天行程）
5. 日期从最近一个周六开始推算
6. 如果网页没有明确日期，根据天数推断
7. 价格如果能从网页提取就填写，否则填null
8. 尽量保留原行程中的特色安排和细节描述`;

router.post('/parse-url', async (req: AuthRequest, res: Response) => {
  const result = parseUrlSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: result.error.issues[0].message });
    return;
  }

  const { url } = result.data;

  // Fetch URL content
  let pageText = '';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const html = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timer);
    const raw = await html.text();
    // Strip HTML tags, scripts, styles
    pageText = raw
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 6000);
  } catch (err: any) {
    res.status(422).json({ error: '无法获取网页内容：' + (err.message || '网络错误') });
    return;
  }

  if (!pageText || pageText.length < 100) {
    res.status(422).json({ error: '网页内容不足，无法解析行程' });
    return;
  }

  try {
    let fullContent = '';
    for await (const chunk of streamDeepSeek([
      { role: 'system', content: SYSTEM_PARSE_URL },
      { role: 'user', content: `请分析以下跟团游产品页面，提取完整行程：\n${pageText}` },
    ])) {
      fullContent += chunk.content;
    }

    const jsonMatch = fullContent.match(/```json\s*([\s\S]*?)\s*```/) || fullContent.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
      res.json(parsed);
    } else {
      res.status(422).json({ error: 'AI 无法解析该网页中的行程信息，请尝试手动复制文字粘贴导入' });
    }
  } catch (err: any) {
    if (err instanceof SyntaxError) {
      res.status(422).json({ error: 'AI 解析失败，请重试' });
    } else {
      res.status(500).json({ error: err.message || '解析失败' });
    }
  }
});

export default router;
