import { Router, Response } from 'express';
import multer from 'multer';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import path from 'path';
import { auth, AuthRequest } from '../middleware/auth';
import { inferTypeFromText } from '../lib/ai-config';

const router = Router();
router.use(auth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = ['.docx', '.md', '.xlsx', '.xls', '.csv', '.txt'];
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`不支持的文件格式: ${ext}，支持: ${allowed.join(', ')}`));
    }
  },
});

// POST /api/import
router.post('/', upload.single('file'), async (req: AuthRequest, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: '请上传文件' });
    return;
  }

  const ext = path.extname(req.file.originalname).toLowerCase();

  try {
    let result;

    switch (ext) {
      case '.docx':
        result = await parseDocx(req.file.buffer);
        break;
      case '.md':
      case '.txt':
        result = parseMarkdown(req.file.buffer.toString('utf-8'));
        break;
      case '.xlsx':
      case '.xls':
        result = parseExcel(req.file.buffer, ext);
        break;
      case '.csv':
        result = parseCSV(req.file.buffer);
        break;
      default:
        res.status(400).json({ error: `不支持的文件格式: ${ext}` });
        return;
    }

    // Merge with trip-level info from form data
    if (req.body.title) result.title = req.body.title;
    if (req.body.destination) result.destination = req.body.destination;

    res.json(result);
  } catch (err: any) {
    res.status(422).json({ error: err.message || '文件解析失败' });
  }
});

// ==================== PARSERS ====================

interface ImportDay {
  label: string;
  date: string;
  items: ImportItem[];
}

interface ImportItem {
  type: string;
  title: string;
  subtitle?: string;
  price?: number;
  note?: string;
  sourceUrl?: string;
}

interface ImportResult {
  title: string;
  destination: string;
  startDate: string;
  endDate: string;
  days: ImportDay[];
  rawText?: string;
}

async function parseDocx(buffer: Buffer): Promise<ImportResult> {
  const { value: text } = await mammoth.extractRawText({ buffer });

  // Try to extract structured info from the text
  const structured = tryStructuredParse(text);
  if (structured) return structured;

  // Return raw text for AI parsing
  return {
    title: '',
    destination: '',
    startDate: '',
    endDate: '',
    days: [],
    rawText: text,
  };
}

function parseMarkdown(text: string): ImportResult {
  const structured = tryStructuredParse(text);
  if (structured) return structured;

  return {
    title: '',
    destination: '',
    startDate: '',
    endDate: '',
    days: [],
    rawText: text,
  };
}

function parseExcel(buffer: Buffer, ext: string): ImportResult {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  if (rows.length === 0) {
    throw new Error('文件为空');
  }

  // Try to identify columns by header
  const header = rows[0].map((h: any) => String(h).toLowerCase().trim());
  const colMap: Record<string, number> = {};
  const knownCols = ['day', 'label', '日期', '天', 'type', '类型', 'title', '标题', 'name', '名称', '酒店', '景点', 'price', 'price', '价格', '费用', 'note', '备注', 'url', '链接', 'subtitle', '副标题', 'date', '时间'];

  header.forEach((h: string, i: number) => {
    colMap[h] = i;
  });

  // Find day index, type index, title index, price index
  const dayIdx = colMap['day'] ?? colMap['label'] ?? colMap['日期'] ?? colMap['天'] ?? 0;
  const typeIdx = colMap['type'] ?? colMap['类型'] ?? 1;
  const titleIdx = colMap['title'] ?? colMap['标题'] ?? colMap['name'] ?? colMap['名称'] ?? colMap['酒店'] ?? colMap['景点'] ?? 2;
  const priceIdx = colMap['price'] ?? colMap['价格'] ?? colMap['费用'] ?? -1;
  const noteIdx = colMap['note'] ?? colMap['备注'] ?? -1;
  const urlIdx = colMap['url'] ?? colMap['链接'] ?? -1;
  const subtitleIdx = colMap['subtitle'] ?? colMap['副标题'] ?? -1;

  // Group by day
  const dayMap = new Map<string, ImportItem[]>();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row[titleIdx] && !row[dayIdx]) continue;

    const dayLabel = String(row[dayIdx] || '第1天').trim();
    const title = String(row[titleIdx] || '').trim();
    if (!title) continue;

    const type = inferTypeFromText(String(row[typeIdx] || ''));

    const item: ImportItem = {
      type,
      title,
      subtitle: subtitleIdx >= 0 ? String(row[subtitleIdx] || '') : undefined,
      note: noteIdx >= 0 ? String(row[noteIdx] || '') : undefined,
      sourceUrl: urlIdx >= 0 ? String(row[urlIdx] || '') : undefined,
    };

    if (priceIdx >= 0) {
      const priceVal = parseFloat(String(row[priceIdx]).replace(/[¥￥,]/g, ''));
      if (!isNaN(priceVal)) item.price = priceVal;
    }

    if (!dayMap.has(dayLabel)) dayMap.set(dayLabel, []);
    dayMap.get(dayLabel)!.push(item);
  }

  const days: ImportDay[] = Array.from(dayMap.entries()).map(([label, items], idx) => ({
    label,
    date: '', // Will be filled by frontend based on trip dates
    items,
  }));

  return {
    title: '',
    destination: '',
    startDate: '',
    endDate: '',
    days,
  };
}

function parseCSV(buffer: Buffer): ImportResult {
  return parseExcel(buffer, '.csv');
}

// ==================== HELPERS ====================

function tryStructuredParse(text: string): ImportResult | null {
  // Try to detect common structured formats:
  // Pattern 1: Markdown headings for days
  // Pattern 2: Numbered day format

  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  // Try markdown format: ## Day 1, ### Hotel, etc.
  const dayPattern = /^#{2,3}\s*(Day|第|day)\s*\d+/i;
  const hasDays = lines.some(l => dayPattern.test(l));
  if (!hasDays) return null;

  let tripTitle = '';
  let destination = '';
  const days: ImportDay[] = [];
  let currentDay: ImportDay | null = null;
  let currentItems: ImportItem[] = [];

  for (const line of lines) {
    // Trip title (first # heading)
    if (line.startsWith('# ') && !tripTitle) {
      tripTitle = line.replace(/^#\s+/, '');
      continue;
    }

    // Day heading
    const dayMatch = line.match(/^#{2,3}\s*(Day\s*\d+|第\d+天)/i);
    if (dayMatch) {
      if (currentDay) {
        currentDay.items = currentItems;
        days.push(currentDay);
      }
      const dayNum = days.length + 1;
      currentDay = {
        label: `第${dayNum}天`,
        date: '',
        items: [],
      };
      currentItems = [];
      continue;
    }

    // Item line: "- [type] title  price  note"
    if (currentDay && line.startsWith('-')) {
      const content = line.replace(/^-\s*/, '');
      const item = parseItemLine(content);
      currentItems.push(item);
    }
  }

  if (currentDay) {
    currentDay.items = currentItems;
    days.push(currentDay);
  }

  if (days.length === 0) return null;

  return {
    title: tripTitle,
    destination,
    startDate: '',
    endDate: '',
    days,
  };
}

function parseItemLine(line: string): ImportItem {
  // Try: "- [hotel] 和平饭店 ¥1280 备注xxx"
  const typeMatch = line.match(/^\[(\w+)\]\s*/);
  let type = 'custom';
  let rest = line;

  if (typeMatch) {
    type = inferTypeFromText(typeMatch[1]);
    rest = line.slice(typeMatch[0].length);
  }

  // Try to extract price: ¥xxx or ￥xxx or $xxx
  let price: number | undefined;
  const priceMatch = rest.match(/[¥￥]\s*(\d[\d,]*\.?\d*)/);
  if (priceMatch) {
    price = parseFloat(priceMatch[1].replace(/,/g, ''));
    rest = rest.replace(priceMatch[0], '').trim();
  }

  // Rest is title + optional note
  const parts = rest.split(/\s{2,}/);
  const title = parts[0] || rest;
  const note = parts.slice(1).join(' ');

  return { type, title, price, note: note || undefined };
}

export default router;
