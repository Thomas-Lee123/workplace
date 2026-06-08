import { Router, Request, Response } from 'express';

const router = Router();

router.get('/image', async (req: Request, res: Response) => {
  const url = req.query.url as string;
  if (!url) {
    res.status(400).json({ error: 'Missing url parameter' });
    return;
  }

  try {
    const fetchRes = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': new URL(url).origin,
      },
    });

    if (!fetchRes.ok) {
      res.status(fetchRes.status).end();
      return;
    }

    const contentType = fetchRes.headers.get('content-type') || 'image/jpeg';
    const cacheControl = fetchRes.headers.get('cache-control') || 'public, max-age=86400';

    res.set('Content-Type', contentType);
    res.set('Cache-Control', cacheControl);
    res.set('Access-Control-Allow-Origin', '*');

    const buffer = await fetchRes.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch {
    res.status(502).end();
  }
});

export default router;
