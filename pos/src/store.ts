// Локальное хранилище кассы. Всё, что нужно для продажи, лежит на планшете,
// поэтому касса продолжает работать без интернета, а чеки уходят на сервер при появлении сети.

export type Product = { id: number; name: string; categoryId: number | null; price: number; unit: string; barcode: string | null };
export type Category = { id: number; name: string; color: string };
export type CartItem = { productId: number | null; name: string; price: number; qty: number; discount: number };
export type Receipt = {
  id: string;
  cashierId: number;
  shiftId: string | null;
  kind: 'sale' | 'return';
  payment: 'cash' | 'card' | 'mixed';
  cardAmount: number;
  createdAt: string;
  items: CartItem[];
};
export type Shift = { id: string; cashierId: number; openedAt: string; closedAt: string | null; openingCash: number; closingCash: number | null };
export type Session = { token: string; user: { id: number; name: string; role: string } };
export type Device = { server: string; addressId: number; addressName: string };

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  if (value === null) localStorage.removeItem(key);
  else localStorage.setItem(key, JSON.stringify(value));
}

export const storage = {
  device: () => load<Device | null>('pos_device', null),
  setDevice: (d: Device | null) => save('pos_device', d),
  session: () => load<Session | null>('pos_session', null),
  setSession: (s: Session | null) => save('pos_session', s),
  catalog: () => load<{ categories: Category[]; products: Product[] }>('pos_catalog', { categories: [], products: [] }),
  setCatalog: (c: { categories: Category[]; products: Product[] }) => save('pos_catalog', c),
  shift: () => load<Shift | null>('pos_shift', null),
  setShift: (s: Shift | null) => save('pos_shift', s),
  // Все чеки текущей смены — для отчёта при закрытии
  shiftReceipts: () => load<Receipt[]>('pos_shift_receipts', []),
  setShiftReceipts: (r: Receipt[]) => save('pos_shift_receipts', r),
  queue: () => load<{ receipts: Receipt[]; shifts: Shift[] }>('pos_queue', { receipts: [], shifts: [] }),
  setQueue: (q: { receipts: Receipt[]; shifts: Shift[] }) => save('pos_queue', q),
};

export function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) =>
    (+c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (+c / 4)))).toString(16));
}

export const lineTotal = (i: CartItem) => Math.round((i.price * i.qty - i.discount) * 100) / 100;
export const cartTotal = (items: CartItem[]) => Math.round(items.reduce((s, i) => s + lineTotal(i), 0) * 100) / 100;

export async function api<T = any>(path: string, init: { method?: string; body?: unknown; token?: string } = {}): Promise<T> {
  const device = storage.device();
  const token = init.token ?? storage.session()?.token;
  const res = await fetch((device?.server ?? '') + path, {
    method: init.method ?? 'GET',
    headers: {
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error ?? `Ошибка ${res.status}`), { status: res.status });
  return data as T;
}

export function enqueue(item: { receipt?: Receipt; shift?: Shift }) {
  const q = storage.queue();
  if (item.receipt) q.receipts.push(item.receipt);
  if (item.shift) q.shifts = [...q.shifts.filter((s) => s.id !== item.shift!.id), item.shift];
  storage.setQueue(q);
}

let syncing = false;
// Отправляет накопленные смены и чеки. Возвращает число неотправленных чеков.
export async function sync(): Promise<number> {
  const q = storage.queue();
  if (syncing || (!q.receipts.length && !q.shifts.length) || !storage.session()) return q.receipts.length;
  syncing = true;
  try {
    const batch = { shifts: q.shifts, receipts: q.receipts.slice(0, 200) };
    const { accepted } = await api<{ accepted: string[] }>('/api/pos/sync', { method: 'POST', body: batch });
    const now = storage.queue();
    const sentShifts = new Set(batch.shifts.map((s) => JSON.stringify(s)));
    storage.setQueue({
      receipts: now.receipts.filter((r) => !accepted.includes(r.id)),
      shifts: now.shifts.filter((s) => !sentShifts.has(JSON.stringify(s))),
    });
  } catch {
    // нет сети — попробуем позже
  } finally {
    syncing = false;
  }
  return storage.queue().receipts.length;
}
