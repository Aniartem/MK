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
export type Promotion = { id: number; name: string; percent: number; mode: 'auto' | 'manual'; categoryIds: number[]; timeFrom: string | null; timeTo: string | null };
export type CashOp = { id: string; cashierId: number; shiftId: string | null; kind: 'deposit' | 'withdrawal'; amount: number; note: string | null; createdAt: string };
export type Catalog = { categories: Category[]; products: Product[]; promotions: Promotion[] };
type Queue = { receipts: Receipt[]; shifts: Shift[]; cashOps: CashOp[] };
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
  catalog: () => ({ categories: [], products: [], promotions: [], ...load<Partial<Catalog>>('pos_catalog', {}) }) as Catalog,
  setCatalog: (c: Catalog) => save('pos_catalog', c),
  shift: () => load<Shift | null>('pos_shift', null),
  setShift: (s: Shift | null) => save('pos_shift', s),
  // Все чеки текущей смены — для отчёта при закрытии
  shiftReceipts: () => load<Receipt[]>('pos_shift_receipts', []),
  setShiftReceipts: (r: Receipt[]) => save('pos_shift_receipts', r),
  shiftCashOps: () => load<CashOp[]>('pos_shift_cash_ops', []),
  setShiftCashOps: (o: CashOp[]) => save('pos_shift_cash_ops', o),
  queue: () => ({ receipts: [], shifts: [], cashOps: [], ...load<Partial<Queue>>('pos_queue', {}) }) as Queue,
  setQueue: (q: Queue) => save('pos_queue', q),
};

export function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) =>
    (+c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (+c / 4)))).toString(16));
}

// Скидка по акциям: автоматические действуют по времени, ручную выбирает кассир. Берётся лучшая из подходящих.
export function applyPromotions(items: CartItem[], products: Product[], promotions: Promotion[], manualId: number | null, now = new Date()) {
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const active = promotions.filter((p) =>
    p.mode === 'auto' ? (!p.timeFrom || p.timeFrom <= hhmm) && (!p.timeTo || hhmm <= p.timeTo) : p.id === manualId,
  );
  return items.map((i) => {
    const categoryId = products.find((p) => p.id === i.productId)?.categoryId ?? null;
    const best = Math.max(0, ...active.filter((p) => !p.categoryIds.length || (categoryId !== null && p.categoryIds.includes(categoryId))).map((p) => p.percent));
    return { ...i, discount: Math.round(i.price * i.qty * best) / 100 };
  });
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

// Постоянный идентификатор планшета: по нему кабинет показывает, какая касса на связи
export function deviceId() {
  let id = localStorage.getItem('pos_device_id');
  if (!id) {
    id = uuid();
    localStorage.setItem('pos_device_id', id);
  }
  return id;
}

export function enqueue(item: { receipt?: Receipt; shift?: Shift; cashOp?: CashOp }) {
  const q = storage.queue();
  if (item.receipt) q.receipts.push(item.receipt);
  if (item.cashOp) q.cashOps.push(item.cashOp);
  if (item.shift) q.shifts = [...q.shifts.filter((s) => s.id !== item.shift!.id), item.shift];
  storage.setQueue(q);
}

let syncing = false;
// Отправляет накопленные смены и чеки. Возвращает число неотправленных чеков.
export async function sync(): Promise<number> {
  const q = storage.queue();
  const pending = q.receipts.length + q.cashOps.length;
  if (syncing || (!pending && !q.shifts.length) || !storage.session()) return pending;
  syncing = true;
  try {
    const batch = { deviceId: deviceId(), pending, shifts: q.shifts, receipts: q.receipts.slice(0, 200), cashOps: q.cashOps };
    const res = await api<{ accepted: string[]; acceptedCashOps: string[] }>('/api/pos/sync', { method: 'POST', body: batch });
    const now = storage.queue();
    const sentShifts = new Set(batch.shifts.map((s) => JSON.stringify(s)));
    storage.setQueue({
      receipts: now.receipts.filter((r) => !res.accepted.includes(r.id)),
      shifts: now.shifts.filter((s) => !sentShifts.has(JSON.stringify(s))),
      cashOps: now.cashOps.filter((o) => !res.acceptedCashOps.includes(o.id)),
    });
  } catch {
    // нет сети — попробуем позже
  } finally {
    syncing = false;
  }
  const left = storage.queue();
  return left.receipts.length + left.cashOps.length;
}
