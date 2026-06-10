const BASE = '/api';

export function proxyImageUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('/') || url.startsWith('data:')) return url;
  return `${BASE}/proxy/image?url=${encodeURIComponent(url)}`;
}

function token() {
  return localStorage.getItem('token') || '';
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(BASE + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `请求失败 (${res.status})`);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

// ==================== Auth ====================

export interface User {
  id: string;
  email: string;
  name: string;
  createdAt?: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export function login(email: string, password: string) {
  return request<AuthResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export function register(email: string, password: string, name: string) {
  return request<AuthResponse>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, name }),
  });
}

export function getMe() {
  return request<User>('/auth/me');
}

// ==================== Trips ====================

export interface Item {
  id: string;
  dayId: string;
  type: 'hotel' | 'attraction' | 'traffic' | 'meal' | 'custom';
  title: string;
  subtitle: string;
  sortOrder: number;
  source: string;
  sourceUrl: string | null;
  price: number | null;
  imageUrl: string | null;
  date: string | null;
  note: string;
  status: 'pending' | 'purchased' | 'cancelled';
  meta: any;
  createdAt: string;
}

export interface Day {
  id: string;
  tripId: string;
  date: string;
  label: string;
  sortOrder: number;
  items: Item[];
}

export interface Trip {
  id: string;
  userId: string;
  title: string;
  destination: string;
  startDate: string;
  endDate: string;
  coverImage: string | null;
  days: Day[];
  createdAt: string;
  updatedAt: string;
}

export function getTrips() {
  return request<Trip[]>('/trips');
}

export function getTrip(id: string) {
  return request<Trip>(`/trips/${id}`);
}

export function createTrip(data: { title: string; destination: string; startDate: string; endDate: string }) {
  return request<Trip>('/trips', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateTrip(id: string, data: { title: string; destination: string; startDate: string; endDate: string }) {
  return request<Trip>(`/trips/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function deleteTrip(id: string) {
  return request<void>(`/trips/${id}`, { method: 'DELETE' });
}

export function addItem(tripId: string, data: Partial<Item>) {
  return request<Item>(`/trips/${tripId}/items`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateItem(tripId: string, itemId: string, data: Partial<Item>) {
  return request<Item>(`/trips/${tripId}/items/${itemId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function updateItemStatus(tripId: string, itemId: string, status: string) {
  return request<Item>(`/trips/${tripId}/items/${itemId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export function deleteItem(tripId: string, itemId: string) {
  return request<void>(`/trips/${tripId}/items/${itemId}`, { method: 'DELETE' });
}

// ==================== Parse ====================

export interface ParseResult {
  title: string | null;
  type: string | null;
  price: number | null;
  imageUrl: string | null;
  date: string | null;
  source: string;
  confidence: 'high' | 'medium' | 'low';
}

export function parseLink(url: string) {
  return request<ParseResult>('/parse', {
    method: 'POST',
    body: JSON.stringify({ url }),
  });
}

// ==================== Import ====================

export interface ImportDay {
  label: string;
  date: string;
  items: ImportItem[];
}

export interface ImportItem {
  type: string;
  title: string;
  subtitle?: string;
  price?: number;
  note?: string;
  sourceUrl?: string;
}

export interface ImportResult {
  title: string;
  destination: string;
  startDate: string;
  endDate: string;
  days: ImportDay[];
  rawText?: string;
}

export async function importFile(file: File, title?: string, destination?: string): Promise<ImportResult> {
  const formData = new FormData();
  formData.append('file', file);
  if (title) formData.append('title', title);
  if (destination) formData.append('destination', destination);

  const res = await fetch('/api/import', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}` },
    body: formData,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || '文件导入失败');
  }

  return res.json();
}

// ==================== AI ====================

export interface SSEEvent {
  type: 'text' | 'done' | 'error';
  content?: string;
  trip?: Trip;
  reply?: string;
  changes?: string;
  tripData?: any;
  error?: string;
}

export function streamAIGenerate(
  prompt: string,
  onEvent: (e: SSEEvent) => void,
  onError: (err: Error) => void,
): AbortController {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout>;

  function resetTimeout() {
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      controller.abort();
      onError(new Error('AI 响应超时，请重试'));
    }, 120000);
  }

  resetTimeout();

  fetch('/api/ai/generate-stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
    body: JSON.stringify({ prompt }),
    signal: controller.signal,
  }).then(async res => {
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      onError(new Error(body.error || '请求失败'));
      return;
    }

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let hasError = false;
    let hasDone = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) { clearTimeout(timeout); break; }

      resetTimeout();
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';

      for (const line of lines) {
        if (hasError) break;
        if (line.startsWith('event: ')) continue;
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.error) {
              hasError = true;
              onError(new Error(data.error));
              break;
            }
            if (data.trip) hasDone = true;
            onEvent(data as SSEEvent);
          } catch {}
        }
      }
    }

    clearTimeout(timeout);
    if (!hasError && !hasDone) {
      onError(new Error('AI 生成超时，请重试'));
    }
  }).catch(err => {
    if (err.name !== 'AbortError') onError(err);
  });

  return controller;
}

export function streamAIChat(
  tripId: string,
  message: string,
  onEvent: (e: SSEEvent) => void,
  onDone: (tripData: any, changes: string) => void,
  onError: (err: Error) => void,
): AbortController {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout>;

  function resetTimeout() {
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      controller.abort();
      onError(new Error('AI 响应超时，请重试'));
    }, 120000);
  }

  resetTimeout();

  fetch('/api/ai/chat-stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
    body: JSON.stringify({ tripId, message }),
    signal: controller.signal,
  }).then(async res => {
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      onError(new Error(body.error || '请求失败'));
      return;
    }

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let lastTripData: any = null;
    let lastChanges = '';
    let hasError = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) { clearTimeout(timeout); break; }

      resetTimeout();
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';

      for (const line of lines) {
        if (hasError) break;
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.error) {
              hasError = true;
              onError(new Error(data.error));
              break;
            }
            if (data.tripData) {
              lastTripData = data.tripData;
              lastChanges = data.changes || '';
            }
            onEvent(data as SSEEvent);
          } catch {}
        }
      }
    }

    clearTimeout(timeout);
    if (!hasError) {
      if (lastTripData) {
        onDone(lastTripData, lastChanges);
      } else {
        onError(new Error('AI 未返回有效的行程数据，请重试'));
      }
    }
  }).catch(err => {
    if (err.name !== 'AbortError') onError(err);
  });

  return controller;
}

export async function aiApplyChanges(tripId: string, tripData: any): Promise<Trip> {
  const res = await fetch('/api/ai/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
    body: JSON.stringify({ tripId, tripData }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || '应用失败');
  }

  return res.json();
}

export async function aiParseText(text: string, extra?: { title?: string; destination?: string; startDate?: string; endDate?: string }): Promise<ImportResult> {
  const res = await fetch('/api/ai/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
    body: JSON.stringify({ text, ...extra }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'AI 解析失败');
  }

  return res.json();
}

export async function parseUrlToTrip(url: string): Promise<ImportResult> {
  const res = await fetch('/api/ai/parse-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
    body: JSON.stringify({ url }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'AI 解析失败');
  }

  return res.json();
}

export interface ItemAnalysis {
  title: string;
  type: string;
  price: number | null;
  imageUrl?: string;
  pros: string[];
  cons: string[];
  distanceAdvice: string;
}

export async function reorderItem(tripId: string, itemId: string, sortOrder: number, dayId?: string): Promise<Item> {
  return request<Item>(`/trips/${tripId}/items/${itemId}/reorder`, {
    method: 'PATCH',
    body: JSON.stringify({ sortOrder, dayId }),
  });
}

export async function analyzeItem(url: string, tripId: string): Promise<ItemAnalysis> {
  const res = await fetch('/api/ai/analyze-item', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
    body: JSON.stringify({ url, tripId }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'AI 分析失败');
  }

  return res.json();
}

export async function downloadExport(tripId: string, format: 'xlsx' | 'doc'): Promise<void> {
  const res = await fetch(`/api/export/${tripId}?format=${format}`, {
    headers: { Authorization: `Bearer ${token()}` },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || '导出失败');
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = format === 'xlsx' ? '行程.xlsx' : '行程.doc';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
