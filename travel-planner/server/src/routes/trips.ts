import { Router, Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { auth, AuthRequest } from '../middleware/auth';

const router = Router();

// All trip routes require auth
router.use(auth);

// ==================== TRIPS ====================

const tripSchema = z.object({
  title: z.string().min(1),
  destination: z.string().min(1),
  startDate: z.string(),
  endDate: z.string(),
  coverImage: z.string().nullable().optional(),
});

// GET /api/trips
router.get('/', async (req: AuthRequest, res: Response) => {
  const trips = await prisma.trip.findMany({
    where: { userId: req.userId },
    include: {
      days: {
        include: { items: { orderBy: { sortOrder: 'asc' } } },
        orderBy: { sortOrder: 'asc' },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  res.json(trips);
});

// POST /api/trips
router.post('/', async (req: AuthRequest, res: Response) => {
  const result = tripSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: result.error.issues[0].message });
    return;
  }

  const { title, destination, startDate, endDate, coverImage } = result.data;
  const start = new Date(startDate);
  const end = new Date(endDate);

  if (end < start) {
    res.status(400).json({ error: '结束日期不能早于开始日期' });
    return;
  }

  const trip = await prisma.trip.create({
    data: {
      userId: req.userId!,
      title,
      destination,
      startDate: start,
      endDate: end,
      coverImage: coverImage ?? null,
      days: {
        create: generateDays(start, end),
      },
    },
    include: {
      days: {
        include: { items: { orderBy: { sortOrder: 'asc' } } },
        orderBy: { sortOrder: 'asc' },
      },
    },
  });

  res.status(201).json(trip);
});

// GET /api/trips/:id
router.get('/:id', async (req: AuthRequest, res: Response) => {
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

  res.json(trip);
});

// PUT /api/trips/:id
router.put('/:id', async (req: AuthRequest, res: Response) => {
  const existing = await prisma.trip.findFirst({
    where: { id: req.params.id, userId: req.userId },
  });
  if (!existing) {
    res.status(404).json({ error: '行程不存在' });
    return;
  }

  const result = tripSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: result.error.issues[0].message });
    return;
  }

  const { title, destination, startDate, endDate, coverImage } = result.data;
  const start = new Date(startDate);
  const end = new Date(endDate);

  const trip = await prisma.trip.update({
    where: { id: req.params.id },
    data: {
      title,
      destination,
      startDate: start,
      endDate: end,
      coverImage: coverImage ?? null,
    },
    include: {
      days: {
        include: { items: { orderBy: { sortOrder: 'asc' } } },
        orderBy: { sortOrder: 'asc' },
      },
    },
  });

  res.json(trip);
});

// DELETE /api/trips/:id
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  const existing = await prisma.trip.findFirst({
    where: { id: req.params.id, userId: req.userId },
  });
  if (!existing) {
    res.status(404).json({ error: '行程不存在' });
    return;
  }

  await prisma.trip.delete({ where: { id: req.params.id } });
  res.status(204).send();
});

// ==================== ITEMS ====================

const itemSchema = z.object({
  dayId: z.string(),
  type: z.enum(['hotel', 'attraction', 'traffic', 'meal', 'custom']),
  title: z.string().min(1),
  subtitle: z.string().optional(),
  source: z.enum(['ctrip', 'mafengwo', 'fliggy', 'meituan', 'qunar', 'manual']).optional(),
  sourceUrl: z.string().nullable().optional(),
  price: z.number().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  date: z.string().nullable().optional(),
  note: z.string().optional(),
  meta: z.any().optional(),
});

// POST /api/trips/:tripId/items
router.post('/:tripId/items', async (req: AuthRequest, res: Response) => {
  const trip = await prisma.trip.findFirst({
    where: { id: req.params.tripId, userId: req.userId },
  });
  if (!trip) {
    res.status(404).json({ error: '行程不存在' });
    return;
  }

  const result = itemSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: result.error.issues[0].message });
    return;
  }

  const maxOrder = await prisma.item.aggregate({
    where: { dayId: result.data.dayId },
    _max: { sortOrder: true },
  });
  const nextOrder = (maxOrder._max.sortOrder ?? -1) + 1;

  const item = await prisma.item.create({
    data: {
      dayId: result.data.dayId,
      type: result.data.type,
      title: result.data.title,
      subtitle: result.data.subtitle || '',
      sortOrder: nextOrder,
      source: result.data.source || 'manual',
      sourceUrl: result.data.sourceUrl ?? null,
      price: result.data.price ?? null,
      imageUrl: result.data.imageUrl ?? null,
      date: result.data.date ? new Date(result.data.date) : null,
      note: result.data.note || '',
    },
  });

  res.status(201).json(item);
});

// PUT /api/trips/:tripId/items/:itemId
router.put('/:tripId/items/:itemId', async (req: AuthRequest, res: Response) => {
  const item = await prisma.item.findFirst({
    where: { id: req.params.itemId, day: { tripId: req.params.tripId, trip: { userId: req.userId } } },
  });
  if (!item) {
    res.status(404).json({ error: '项目不存在' });
    return;
  }

  const result = itemSchema.partial().safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: result.error.issues[0].message });
    return;
  }

  const updated = await prisma.item.update({
    where: { id: req.params.itemId },
    data: {
      ...result.data,
      date: result.data.date ? new Date(result.data.date) : undefined,
    },
  });

  res.json(updated);
});

// PATCH /api/trips/:tripId/items/:itemId/status
router.patch('/:tripId/items/:itemId/status', async (req: AuthRequest, res: Response) => {
  const { status } = req.body;
  if (!['pending', 'purchased', 'cancelled'].includes(status)) {
    res.status(400).json({ error: '状态值无效' });
    return;
  }

  const item = await prisma.item.findFirst({
    where: { id: req.params.itemId, day: { tripId: req.params.tripId, trip: { userId: req.userId } } },
  });
  if (!item) {
    res.status(404).json({ error: '项目不存在' });
    return;
  }

  const updated = await prisma.item.update({
    where: { id: req.params.itemId },
    data: { status },
  });

  res.json(updated);
});

// PATCH /api/trips/:tripId/items/:itemId/reorder
router.patch('/:tripId/items/:itemId/reorder', async (req: AuthRequest, res: Response) => {
  const item = await prisma.item.findFirst({
    where: { id: req.params.itemId, day: { tripId: req.params.tripId, trip: { userId: req.userId } } },
  });
  if (!item) {
    res.status(404).json({ error: '项目不存在' });
    return;
  }

  const { sortOrder, dayId } = req.body;
  if (typeof sortOrder !== 'number') {
    res.status(400).json({ error: 'sortOrder 必填' });
    return;
  }

  const targetDayId = dayId || item.dayId;

  // Shift other items in target day to make room
  if (targetDayId === item.dayId) {
    // Same day: shift items between old and new positions
    if (sortOrder > item.sortOrder) {
      await prisma.item.updateMany({
        where: { dayId: targetDayId, sortOrder: { gt: item.sortOrder, lte: sortOrder }, id: { not: item.id } },
        data: { sortOrder: { decrement: 1 } },
      });
    } else if (sortOrder < item.sortOrder) {
      await prisma.item.updateMany({
        where: { dayId: targetDayId, sortOrder: { gte: sortOrder, lt: item.sortOrder }, id: { not: item.id } },
        data: { sortOrder: { increment: 1 } },
      });
    }
  } else {
    // Different day: close gap in old day, make room in new day
    await prisma.item.updateMany({
      where: { dayId: item.dayId, sortOrder: { gt: item.sortOrder } },
      data: { sortOrder: { decrement: 1 } },
    });
    await prisma.item.updateMany({
      where: { dayId: targetDayId, sortOrder: { gte: sortOrder } },
      data: { sortOrder: { increment: 1 } },
    });
  }

  const updated = await prisma.item.update({
    where: { id: req.params.itemId },
    data: { sortOrder, dayId: targetDayId },
  });

  res.json(updated);
});

// DELETE /api/trips/:tripId/items/:itemId
router.delete('/:tripId/items/:itemId', async (req: AuthRequest, res: Response) => {
  const item = await prisma.item.findFirst({
    where: { id: req.params.itemId, day: { tripId: req.params.tripId, trip: { userId: req.userId } } },
  });
  if (!item) {
    res.status(404).json({ error: '项目不存在' });
    return;
  }

  await prisma.item.delete({ where: { id: req.params.itemId } });
  res.status(204).send();
});

// ==================== HELPERS ====================

function generateDays(start: Date, end: Date, labels?: string[]) {
  const days = [];
  const diff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  for (let i = 0; i < diff; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    days.push({
      date: d,
      label: (labels && labels[i]) || `Day ${i + 1}`,
      sortOrder: i,
    });
  }
  return days;
}

export default router;
