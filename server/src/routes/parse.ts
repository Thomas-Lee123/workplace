import { Router, Response } from 'express';
import { z } from 'zod';
import { auth, AuthRequest } from '../middleware/auth';

const router = Router();

router.use(auth);

const parseSchema = z.object({
  url: z.string().url('请提供有效的链接'),
});

// POST /api/parse
router.post('/', async (req: AuthRequest, res: Response) => {
  const result = parseSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: result.error.issues[0].message });
    return;
  }

  const { url } = result.data;

  try {
    const data = await parseUrl(url);
    res.json(data);
  } catch (err: any) {
    res.status(422).json({ error: err.message || '解析失败' });
  }
});

// ==================== PARSER ====================

interface ParseResult {
  title: string | null;
  type: string | null;
  price: number | null;
  imageUrl: string | null;
  date: string | null;
  source: string;
  confidence: 'high' | 'medium' | 'low';
}

async function parseUrl(url: string): Promise<ParseResult> {
  const source = detectSource(url);
  let html = '';

  try {
    html = await fetchHtml(url);
  } catch {
    // fetch failed, go straight to AI
    return aiParse(url, source, '');
  }

  // Layer 1: OG tags
  const og = parseOG(html);

  // Layer 2: JSON-LD
  const ld = parseJSONLD(html);

  // Layer 3: SSR preloaded state
  const ssr = parseSSRState(html);

  // Layer 4: Extract from title/headings/visible text
  const extracted = extractFromHTML(html);

  // Merge: later layers override earlier ones
  const merged: ParseResult = {
    title: ld.title ?? ssr.title ?? og.title ?? extracted.title ?? null,
    type: ld.type ?? ssr.type ?? og.type ?? extracted.type ?? null,
    price: ld.price ?? ssr.price ?? og.price ?? extracted.price ?? null,
    imageUrl: ld.imageUrl ?? ssr.imageUrl ?? og.imageUrl ?? extracted.imageUrl ?? null,
    date: ld.date ?? ssr.date ?? og.date ?? extracted.date ?? null,
    source,
    confidence: ld.title ? 'high' : og.title ? 'high' : 'medium',
  };

  if (merged.title) return merged;

  // Layer 5: AI fallback
  const text = stripHtml(html).slice(0, 3000);
  return aiParse(url, source, text);
}

// ==================== SOURCE DETECTION ====================

function detectSource(url: string): string {
  const host = new URL(url).hostname;
  if (host.includes('ctrip') || host.includes('trip.com')) return 'ctrip';
  if (host.includes('fliggy') || host.includes('alitrip')) return 'fliggy';
  if (host.includes('mafengwo')) return 'mafengwo';
  if (host.includes('12306')) return '12306';
  if (host.includes('qunar')) return 'qunar';
  if (host.includes('meituan')) return 'meituan';
  if (host.includes('tongcheng') || host.includes('ly.com')) return 'tongcheng';
  if (host.includes('dianping')) return 'dianping';
  if (host.includes('xiaohongshu') || host.includes('xhslink')) return 'xiaohongshu';
  return 'other';
}

// ==================== HTML FETCH ====================

async function fetchHtml(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
      redirect: 'follow',
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    return res.text();
  } finally {
    clearTimeout(timer);
  }
}

// ==================== LAYER 1: OG TAGS ====================

function parseOG(html: string): Partial<ParseResult> {
  const getMeta = (prop: string): string | null => {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i');
    const m = html.match(re);
    return m?.[1] ?? null;
  };

  const title = getMeta('og:title');
  const description = getMeta('og:description');
  const image = getMeta('og:image');

  let price: number | null = null;
  const priceMatch = (title || description || '').match(/[¥￥](\d+(?:,\d{3})*(?:\.\d+)?)/);
  if (priceMatch) {
    price = parseFloat(priceMatch[1].replace(/,/g, ''));
  }

  return { title, imageUrl: image, price };
}

// ==================== LAYER 2: JSON-LD ====================

function parseJSONLD(html: string): Partial<ParseResult> {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i;
  const m = html.match(re);
  if (!m) return {};

  try {
    const data = JSON.parse(m[1]);
    const item = Array.isArray(data) ? data[0] : data;

    let type: string | null = null;
    if (item['@type']) {
      const t = item['@type'];
      if (/hotel| lodging/i.test(t)) type = 'hotel';
      else if (/tourist|attraction|landmark/i.test(t)) type = 'attraction';
      else if (/flight|train/i.test(t)) type = 'traffic';
      else if (/restaurant|food/i.test(t)) type = 'meal';
    }

    return {
      title: item.name || null,
      imageUrl: item.image || null,
      price: extractPrice(item),
      type,
    };
  } catch {
    return {};
  }
}

function extractPrice(item: any): number | null {
  const price = item.offers?.price || item.price;
  if (typeof price === 'string') {
    const m = price.match(/[\d,]+\.?\d*/);
    if (m) return parseFloat(m[0].replace(/,/g, ''));
  }
  if (typeof price === 'number') return price;
  return null;
}

// ==================== LAYER 3: SSR STATE ====================

function parseSSRState(html: string): Partial<ParseResult> {
  // Many Chinese SPAs embed preloaded state in script tags
  const patterns = [
    /window\.__PRELOADED_STATE__\s*=\s*([\s\S]*?);\s*<\/script>/i,
    /window\.__INITIAL_STATE__\s*=\s*([\s\S]*?);\s*<\/script>/i,
    /window\.__NUXT__\s*=\s*([\s\S]*?);\s*<\/script>/i,
    /window\.__NEXT_DATA__\s*=\s*([\s\S]*?);\s*<\/script>/i,
  ];

  for (const pattern of patterns) {
    const m = html.match(pattern);
    if (!m) continue;
    try {
      const data = JSON.parse(m[1]);
      // Walk the state tree looking for known keys
      const found = findInObject(data, [
        'hotelName', 'hotel_name', 'poiName', 'poi_name', 'productName',
        'name', 'title', 'scenicName', 'ticketName',
        'price', 'minPrice', 'lowestPrice', 'sellPrice',
        'image', 'coverImage', 'mainImage', 'picUrl',
        'checkInDate', 'travelDate', 'useDate',
      ]);
      if (found.title || found.price) return found;
    } catch {}
  }

  return {};
}

function findInObject(obj: any, keys: string[]): Partial<ParseResult> {
  const result: any = {};
  if (!obj || typeof obj !== 'object') return result;

  function walk(node: any) {
    if (!node || typeof node !== 'object' || result.title) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    for (const [k, v] of Object.entries(node)) {
      if (!result.title && keys.includes(k) && typeof v === 'string' && v.length > 1) {
        result.title = v;
      }
      if (!result.price && keys.includes(k) && (typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v)))) {
        result.price = Number(v);
      }
      if (!result.imageUrl && keys.includes(k) && typeof v === 'string' && /^https?:\/\//.test(v)) {
        result.imageUrl = v;
      }
      if (typeof v === 'object') walk(v);
    }
  }

  walk(obj);
  return result;
}

// ==================== LAYER 4: HTML EXTRACTION ====================

function extractFromHTML(html: string): Partial<ParseResult> {
  // Title tag
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch?.[1]?.trim() || null;

  // h1
  const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  const h1 = h1Match?.[1]?.trim() || null;

  // price patterns in HTML
  const pricePatterns = [
    /[¥￥]\s*(\d+(?:,\d{3})*(?:\.\d{1,2})?)\s*(?:起|元|人)?/g,
    /(\d+)\s*元\s*(?:起)?/g,
  ];
  let price: number | null = null;
  for (const p of pricePatterns) {
    const m = p.exec(html);
    if (m) {
      price = parseFloat(m[1].replace(/,/g, ''));
      break;
    }
  }

  // Image from common patterns
  let imageUrl: string | null = null;
  const imgMatch = html.match(/<img[^>]+src=["']([^"']+?(?:hotel|room|scenic|view|ticket)[^"']*)["']/i)
    || html.match(/<img[^>]+src=["']([^"']+\.(?:jpg|png|webp))["']/i);
  if (imgMatch) imageUrl = imgMatch[1];

  const type = inferTypeFromText(html.slice(0, 5000));

  return { title: h1 || title, type, price, imageUrl };
}

function inferTypeFromText(text: string): string | null {
  const t = text.toLowerCase();
  if (t.includes('酒店') || t.includes('hotel') || t.includes('住宿') || t.includes('民宿')) return 'hotel';
  if (t.includes('门票') || t.includes('景点') || t.includes('ticket') || t.includes('景区') || t.includes('公园')) return 'attraction';
  if (t.includes('火车') || t.includes('高铁') || t.includes('动车') || t.includes('飞机') || t.includes('航班')) return 'traffic';
  if (t.includes('餐厅') || t.includes('美食') || t.includes('自助') || t.includes('火锅')) return 'meal';
  return null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x?[0-9a-f]+;/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ==================== LAYER 5: AI FALLBACK ====================

const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || '';
const MODEL = 'deepseek-v4-flash';

const PLATFORM_HINTS: Record<string, string> = {
  ctrip: '携程旅行网。URL中可能包含hotel(酒店)、ticket(门票)、flight(机票)等路径，通过路径和标题判断类型。',
  fliggy: '飞猪旅行（阿里旅行）。URL中tag或名称通常能反映商品类型。',
  mafengwo: '马蜂窝旅游。POI页面通常是景点或酒店，游记攻略链接可能包含多日行程信息。',
  '12306': '铁路12306。此链接可能是火车票、车次查询或车站信息。',
  qunar: '去哪儿网。综合旅游平台，可能包含酒店、机票、门票等。',
  meituan: '美团。通常包含酒店、门票、餐饮团购信息。',
  tongcheng: '同程旅行。综合旅游平台，酒店、门票、机票。',
  dianping: '大众点评。通常是餐厅、酒店或景点评价页。',
  xiaohongshu: '小红书。通常是笔记/攻略，包含旅行推荐，需要从文本中提取。',
  other: '未知平台。请根据URL路径和页面文本推断。',
};

async function aiParse(url: string, source: string, text: string): Promise<ParseResult> {
  const hint = PLATFORM_HINTS[source] || PLATFORM_HINTS.other;
  const systemPrompt = `你是旅行信息提取助手。用户给你一个链接和可能的页面文本，你需要提取其中的旅行项目信息。

${hint}

请返回一个JSON对象：
{
  "title": "项目名称（必填，尽量从URL或文本中推断）",
  "type": "hotel|attraction|traffic|meal|custom（根据内容判断）",
  "price": 数字或null,
  "imageUrl": "图片URL或null",
  "date": "日期(YYYY-MM-DD)或null",
  "source": "${source}"
}

规则：
1. 如果文本中没有明确信息，从URL路径推断（如/hotel/xxx→hotel类）
2. title尽量简短明了，不要包含无关信息
3. 日期只在明确出现时填写
4. 价格只在文本中明确提到时填写`;

  try {
    const res = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${DEEPSEEK_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `链接: ${url}\n平台: ${source}\n页面文本: ${text || '无法获取页面内容'}` },
        ],
        max_tokens: 512,
        temperature: 0.1,
      }),
    });

    if (!res.ok) {
      throw new Error(`AI 请求失败 (${res.status})`);
    }

    const data = await res.json() as any;
    const content = data.choices?.[0]?.message?.content || '';

    // Parse JSON from AI response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { title: null, type: null, price: null, imageUrl: null, date: null, source, confidence: 'low' };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      title: parsed.title || null,
      type: parsed.type || null,
      price: typeof parsed.price === 'number' ? parsed.price : null,
      imageUrl: parsed.imageUrl || null,
      date: parsed.date || null,
      source,
      confidence: parsed.title ? 'medium' : 'low',
    };
  } catch {
    return { title: null, type: null, price: null, imageUrl: null, date: null, source, confidence: 'low' };
  }
}

export default router;