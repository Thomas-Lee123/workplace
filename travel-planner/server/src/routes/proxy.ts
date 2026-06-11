import { Router, Response } from 'express';
import dns from 'dns/promises';
import http from 'http';
import https from 'https';
import { auth, AuthRequest } from '../middleware/auth';

const router = Router();

router.use(auth);

// Private/internal IP ranges that must be blocked
const BLOCKED_CIDRS = [
  { prefix: 0x7f000000n, bits: 8 },       // 127.0.0.0/8 (loopback)
  { prefix: 0x0a000000n, bits: 8 },       // 10.0.0.0/8 (private)
  { prefix: 0xac100000n, bits: 12 },      // 172.16.0.0/12 (private)
  { prefix: 0xc0a80000n, bits: 16 },      // 192.168.0.0/16 (private)
  { prefix: 0xa9fe0000n, bits: 16 },      // 169.254.0.0/16 (link-local)
  { prefix: 0x64400000n, bits: 10 },      // 100.64.0.0/10 (CGNAT)
  { prefix: 0xc6120000n, bits: 15 },      // 198.18.0.0/15 (benchmark)
  { prefix: 0x00000000000000000000000000000001n, bits: 128 }, // IPv6 loopback
  { prefix: 0xfe800000000000000000000000000000n, bits: 10 },  // IPv6 link-local
  { prefix: 0xfc000000000000000000000000000000n, bits: 7 },   // IPv6 unique-local
];

function ip4ToInt(ip: string): bigint {
  const parts = ip.split('.').map(Number);
  return (BigInt(parts[0]) << 24n) | (BigInt(parts[1]) << 16n) | (BigInt(parts[2]) << 8n) | BigInt(parts[3]);
}

function ip6ToInt(ip: string): bigint {
  if (ip.includes('::')) {
    const [left, right] = ip.split('::');
    const leftSegs = left ? left.split(':').filter(Boolean) : [];
    const rightSegs = right ? right.split(':').filter(Boolean) : [];
    const zeros = Array(8 - leftSegs.length - rightSegs.length).fill('0');
    const expanded = [...leftSegs, ...zeros, ...rightSegs];
    let val = 0n;
    for (const s of expanded) {
      val = (val << 16n) | BigInt(parseInt(s || '0', 16));
    }
    return val;
  }
  const segs = ip.split(':');
  let val = 0n;
  for (const s of segs) {
    val = (val << 16n) | BigInt(parseInt(s || '0', 16));
  }
  return val;
}

function isPrivateIp(ip: string): boolean {
  if (ip.includes(':')) {
    const val = ip6ToInt(ip);
    return BLOCKED_CIDRS.some(c => c.prefix >> (128n - BigInt(c.bits)) === val >> (128n - BigInt(c.bits)));
  }
  const val = ip4ToInt(ip);
  return BLOCKED_CIDRS.some(c => c.prefix >> (32n - BigInt(c.bits)) === val >> (32n - BigInt(c.bits)));
}

async function resolveAndValidate(raw: string): Promise<{ url: URL; ip: string; family: number }> {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('Invalid URL');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only http/https URLs are allowed');
  }

  let addresses: { address: string; family: number }[];
  try {
    addresses = await Promise.race([
      dns.lookup(parsed.hostname, { all: true }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('DNS timeout')), 5000)),
    ]);
  } catch {
    throw new Error('Cannot resolve hostname');
  }

  if (!addresses || addresses.length === 0) {
    throw new Error('No addresses found for hostname');
  }

  for (const addr of addresses) {
    if (isPrivateIp(addr.address)) {
      throw new Error('Access to internal addresses is not allowed');
    }
  }

  return { url: parsed, ip: addresses[0].address, family: addresses[0].family };
}

// Outbound request that connects to a pinned IP, eliminating DNS rebinding window.
// SNI is set to the original hostname so TLS handshake and virtual hosting still work.
function fetchImagePinned(
  target: URL,
  ip: string,
  family: number,
): Promise<{ ok: boolean; status: number; contentType: string; cacheControl: string; buffer: Buffer }> {
  return new Promise((resolve, reject) => {
    const isHttps = target.protocol === 'https:';
    const options: http.RequestOptions & { servername?: string } = {
      hostname: ip,
      family,
      port: target.port || (isHttps ? 443 : 80),
      path: target.pathname + target.search,
      method: 'GET',
      timeout: 8000,
      headers: {
        'Host': target.hostname,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': target.origin,
        'Accept': 'image/*',
      },
    };
    if (isHttps) {
      options.servername = target.hostname;
    }

    const req = (isHttps ? https : http).request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          ok: (res.statusCode || 500) < 400,
          status: res.statusCode || 500,
          contentType: String(res.headers['content-type'] || 'image/jpeg'),
          cacheControl: String(res.headers['cache-control'] || 'public, max-age=86400'),
          buffer: Buffer.concat(chunks),
        });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    req.end();
  });
}

router.get('/image', async (req: AuthRequest, res: Response) => {
  const raw = req.query.url as string;
  if (!raw) {
    res.status(400).json({ error: 'Missing url parameter' });
    return;
  }

  let resolved: { url: URL; ip: string; family: number };
  try {
    resolved = await resolveAndValidate(raw);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
    return;
  }

  try {
    const result = await fetchImagePinned(resolved.url, resolved.ip, resolved.family);
    if (!result.ok) {
      res.status(result.status).end();
      return;
    }
    res.set('Content-Type', result.contentType);
    res.set('Cache-Control', result.cacheControl);
    res.send(result.buffer);
  } catch {
    res.status(502).end();
  }
});

export default router;
