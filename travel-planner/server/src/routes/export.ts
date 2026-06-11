import { Router } from 'express';
import { auth, AuthRequest } from '../middleware/auth';
import prisma from '../lib/prisma';
import * as XLSX from 'xlsx';

const router = Router();
router.use(auth);

const TYPE_LABELS: Record<string, string> = {
  hotel: '🏨 酒店',
  attraction: '🎫 景点',
  traffic: '🚄 交通',
  meal: '🍽 餐饮',
  custom: '📌 其他',
};

const STATUS_LABELS: Record<string, string> = {
  pending: '待购',
  purchased: '已购',
  cancelled: '取消',
};

const SOURCE_LABELS: Record<string, string> = {
  ctrip: '携程',
  mafengwo: '马蜂窝',
  fliggy: '飞猪',
  meituan: '美团',
  qunar: '去哪儿',
  manual: '手动',
};

function fmtDate(d: Date): string {
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  return `${m}/${day} 周${weekdays[d.getDay()]}`;
}

// GET /api/export/:id?format=xlsx|doc
router.get('/:id', async (req: AuthRequest, res) => {
  const format = (req.query.format as string) || 'xlsx';

  const trip = await prisma.trip.findFirst({
    where: { id: req.params.id, userId: req.userId },
    include: {
      days: {
        include: { items: { orderBy: { sortOrder: 'asc' } } },
        orderBy: { sortOrder: 'asc' },
      },
    },
  });

  if (!trip) {
    res.status(404).json({ error: '行程不存在' });
    return;
  }

  const filename = encodeURIComponent(trip.title || '行程');

  if (format === 'doc') {
    const html = buildDocHtml(trip);
    res.setHeader('Content-Type', 'application/msword');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.doc"`);
    res.send(html);
    return;
  }

  // Default: xlsx
  const wb = buildXlsx(trip);
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
  res.send(buf);
});

function buildXlsx(trip: any): XLSX.WorkBook {
  const rows: any[][] = [];

  // --- Header ---
  const metaCols = 8; // 日期 | 天数 | 类型 | 项目 | 详情 | 价格 | 状态 | 来源

  rows.push([trip.title]); // row 0, will merge
  rows.push([]); // row 1 empty
  rows.push([
    `目的地: ${trip.destination}`,
    '',
    `${new Date(trip.startDate).toLocaleDateString('zh-CN')} — ${new Date(trip.endDate).toLocaleDateString('zh-CN')}`,
  ]);

  const allItems = trip.days.flatMap((d: any) => d.items);
  const total = allItems.length;
  const purchased = allItems.filter((i: any) => i.status === 'purchased').length;
  const pending = allItems.filter((i: any) => i.status === 'pending').length;
  const budget = allItems.reduce((s: number, i: any) => s + (i.price || 0), 0);

  rows.push([
    `共 ${total} 项`,
    '',
    `待购 ${pending}`,
    `已购 ${purchased}`,
    '',
    '',
    '',
    `预算 ¥${budget.toLocaleString()}`,
  ]);
  rows.push([]); // empty row

  // --- Headers ---
  rows.push(['日期', '天数', '类型', '项目', '详情', '价格', '状态', '来源']);

  // --- Data rows ---
  for (const day of trip.days) {
    const dateStr = fmtDate(new Date(day.date));
    const sorted = [...day.items].sort((a: any, b: any) => a.sortOrder - b.sortOrder);

    if (sorted.length === 0) {
      rows.push([dateStr, day.label, '', '(无项目)', '', '', '', '']);
      continue;
    }

    for (let i = 0; i < sorted.length; i++) {
      const item = sorted[i];
      rows.push([
        i === 0 ? dateStr : '',
        i === 0 ? day.label : '',
        TYPE_LABELS[item.type] || item.type,
        item.title,
        item.subtitle || '',
        item.price != null ? item.price : '',
        STATUS_LABELS[item.status] || item.status,
        SOURCE_LABELS[item.source] || item.source,
      ]);
    }
  }

  // --- Summary row ---
  rows.push([]);
  rows.push(['', '', '', '', '', '总预算', budget, '']);

  // --- Build sheet ---
  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Merge title row (row 0, cols 0..7)
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 7 } }];

  // Column widths
  ws['!cols'] = [
    { wch: 14 }, // 日期
    { wch: 8 },  // 天数
    { wch: 12 }, // 类型
    { wch: 24 }, // 项目
    { wch: 20 }, // 详情
    { wch: 10 }, // 价格
    { wch: 8 },  // 状态
    { wch: 8 },  // 来源
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '行程单');
  return wb;
}

function buildDocHtml(trip: any): string {
  const allItems = trip.days.flatMap((d: any) => d.items);
  const budget = allItems.reduce((s: number, i: any) => s + (i.price || 0), 0);
  const total = allItems.length;
  const purchased = allItems.filter((i: any) => i.status === 'purchased').length;
  const pending = allItems.filter((i: any) => i.status === 'pending').length;

  let daysHtml = '';
  for (const day of trip.days) {
    const sorted = [...day.items].sort((a: any, b: any) => a.sortOrder - b.sortOrder);
    daysHtml += `
      <h2 class="day-title">${day.label} — ${fmtDate(new Date(day.date))}</h2>
    `;
    if (sorted.length === 0) {
      daysHtml += `<p class="day-empty">暂无项目</p>`;
    } else {
      daysHtml += `
        <table>
          <tr><th>类型</th><th>项目</th><th>详情</th><th>价格</th><th>状态</th><th>来源</th></tr>
      `;
      for (const item of sorted) {
        daysHtml += `
          <tr>
            <td>${TYPE_LABELS[item.type] || item.type}</td>
            <td>${esc(item.title)}</td>
            <td>${esc(item.subtitle || '')}</td>
            <td>${item.price != null ? '¥' + item.price.toLocaleString() : ''}</td>
            <td>${STATUS_LABELS[item.status]}</td>
            <td>${SOURCE_LABELS[item.source] || item.source}</td>
          </tr>
        `;
      }
      daysHtml += '</table>';
    }
  }

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="generator" content="一键旅行">
<title>${esc(trip.title)}</title>
<style>
  body { font-family: "Microsoft YaHei", "PingFang SC", sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; color: #333; }
  h1 { text-align: center; font-size: 24px; margin-bottom: 4px; }
  .meta { text-align: center; color: #666; font-size: 14px; margin-bottom: 8px; }
  .stats { text-align: center; font-size: 13px; margin-bottom: 20px; color: #999; }
  .stats span { margin: 0 8px; }
  h2.day-title { font-size: 16px; margin: 24px 0 8px; padding-bottom: 4px; border-bottom: 2px solid #1677ff; color: #1677ff; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 13px; }
  th { background: #f5f5f5; padding: 6px 8px; text-align: left; border: 1px solid #ddd; }
  td { padding: 6px 8px; border: 1px solid #ddd; }
  .day-empty { color: #999; font-size: 13px; padding: 8px 0; }
  .footer { text-align: center; color: #999; font-size: 12px; margin-top: 32px; border-top: 1px solid #eee; padding-top: 12px; }
</style>
</head>
<body>
  <h1>${esc(trip.title)}</h1>
  <p class="meta">${esc(trip.destination)} | ${new Date(trip.startDate).toLocaleDateString('zh-CN')} — ${new Date(trip.endDate).toLocaleDateString('zh-CN')}</p>
  <p class="stats">
    <span>共 ${total} 项</span><span>待购 ${pending}</span><span>已购 ${purchased}</span><span>预算 ¥${budget.toLocaleString()}</span>
  </p>
  ${daysHtml}
  <p class="footer">由「一键旅行」生成 | lsy567.com</p>
</body>
</html>`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export default router;
