import { useCallback, useEffect, useMemo, useState } from 'react';
import { fiscal } from './fiscal';
import {
  api, cartTotal, CartItem, enqueue, lineTotal, Product, Receipt, Session, Shift, storage, sync, uuid,
} from './store';

const fmt = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rub = (v: number) => `${fmt.format(v)} ₽`;

export default function App() {
  const [device, setDevice] = useState(storage.device());
  const [session, setSession] = useState(storage.session());
  const [shift, setShift] = useState(storage.shift());

  if (!device) return <Setup onDone={(d) => { storage.setDevice(d); setDevice(d); }} />;
  if (!session) return <PinLock addressId={device.addressId} addressName={device.addressName} onLogin={(s) => { storage.setSession(s); setSession(s); }} />;

  const lock = () => {
    sync();
    storage.setSession(null);
    setSession(null);
  };
  if (!shift) {
    return (
      <OpenShift
        session={session}
        onOpen={async (cash) => {
          const s: Shift = { id: uuid(), cashierId: session.user.id, openedAt: new Date().toISOString(), closedAt: null, openingCash: cash, closingCash: null };
          await fiscal.openShift(session.user.name);
          storage.setShift(s);
          storage.setShiftReceipts([]);
          enqueue({ shift: s });
          sync();
          setShift(s);
        }}
        onLock={lock}
      />
    );
  }
  return (
    <Register
      session={session}
      addressName={device.addressName}
      addressId={device.addressId}
      shift={shift}
      onLock={lock}
      onShiftClosed={() => setShift(null)}
    />
  );
}

// Первичная настройка планшета: адрес сервера и точка продаж
function Setup({ onDone }: { onDone: (d: { server: string; addressId: number; addressName: string }) => void }) {
  const [server, setServer] = useState(location.protocol.startsWith('http') ? location.origin : 'https://');
  const [addresses, setAddresses] = useState<{ id: number; name: string }[] | null>(null);
  const [error, setError] = useState('');

  async function connect() {
    setError('');
    try {
      const res = await fetch(server.replace(/\/$/, '') + '/api/public/addresses');
      if (!res.ok) throw new Error();
      setAddresses(await res.json());
    } catch {
      setError('Сервер недоступен. Проверьте адрес и интернет.');
    }
  }

  return (
    <div className="center-screen">
      <div className="panel setup">
        <h1>Настройка кассы</h1>
        <label>
          Адрес сервера
          <input value={server} onChange={(e) => setServer(e.target.value)} />
        </label>
        <button className="big primary" onClick={connect}>Подключиться</button>
        {error && <div className="error">{error}</div>}
        {addresses && (
          <>
            <p>Выберите точку, где стоит этот планшет:</p>
            {addresses.map((a) => (
              <button key={a.id} className="big" onClick={() => onDone({ server: server.replace(/\/$/, ''), addressId: a.id, addressName: a.name })}>
                {a.name}
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function Keypad({ value, onChange, max = 8 }: { value: string; onChange: (v: string) => void; max?: number }) {
  const press = (k: string) => {
    if (k === '⌫') onChange(value.slice(0, -1));
    else if (k === 'C') onChange('');
    else if (value.length < max) onChange(value + k);
  };
  return (
    <div className="keypad">
      {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map((k) => (
        <button key={k} onClick={() => press(k)}>{k}</button>
      ))}
    </div>
  );
}

function PinLock({ addressId, addressName, onLogin }: { addressId: number; addressName: string; onLogin: (s: Session) => void }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (pin.length < 4 || busy) return;
    setBusy(true);
    setError('');
    api<Session>('/api/auth/pin', { method: 'POST', body: { addressId, pin } })
      .then(async (s) => {
        // Каталог обновляем при каждом входе; если сети нет — работаем на сохранённом
        try {
          storage.setCatalog(await api('/api/pos/catalog', { token: s.token }));
        } catch { /* офлайн */ }
        onLogin(s);
      })
      .catch((e) => {
        setError(e.status === 401 ? 'Неверный PIN' : 'Нет связи с сервером');
        setPin('');
      })
      .finally(() => setBusy(false));
  }, [pin]);

  return (
    <div className="center-screen">
      <div className="panel pin">
        <div className="muted">{addressName}</div>
        <h1>Введите PIN</h1>
        <div className="pin-dots">{Array.from({ length: 4 }, (_, i) => <i key={i} className={i < pin.length ? 'on' : ''} />)}</div>
        <div className="error">{error}&nbsp;</div>
        <Keypad value={pin} onChange={setPin} max={4} />
      </div>
    </div>
  );
}

function OpenShift({ session, onOpen, onLock }: { session: Session; onOpen: (cash: number) => void; onLock: () => void }) {
  const [cash, setCash] = useState('');
  return (
    <div className="center-screen">
      <div className="panel pin">
        <div className="muted">{session.user.name}</div>
        <h1>Открыть смену</h1>
        <p>Наличные в кассе на начало смены</p>
        <div className="amount">{rub(Number(cash || 0))}</div>
        <Keypad value={cash} onChange={setCash} />
        <button className="big primary" onClick={() => onOpen(Number(cash || 0))}>Открыть смену</button>
        <button className="big" onClick={onLock}>Выйти</button>
      </div>
    </div>
  );
}

function Register(props: {
  session: Session; addressName: string; addressId: number; shift: Shift; onLock: () => void; onShiftClosed: () => void;
}) {
  const { session, shift } = props;
  const [catalog] = useState(storage.catalog());
  const [category, setCategory] = useState<number | 'all'>('all');
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [mode, setMode] = useState<'sale' | 'return'>('sale');
  const [modal, setModal] = useState<'cash' | 'writeoff' | 'close' | null>(null);
  const [pending, setPending] = useState(storage.queue().receipts.length);
  const [online, setOnline] = useState(navigator.onLine);
  const [toast, setToast] = useState('');

  const total = cartTotal(cart);
  const products = useMemo(
    () =>
      catalog.products.filter(
        (p) => (category === 'all' || p.categoryId === category) && p.name.toLowerCase().includes(search.toLowerCase()),
      ),
    [catalog, category, search],
  );
  const colorOf = (p: Product) => catalog.categories.find((c) => c.id === p.categoryId)?.color ?? '#8a94a6';

  const add = useCallback((p: Product) => {
    setCart((c) => {
      const existing = c.find((i) => i.productId === p.id);
      if (existing) return c.map((i) => (i === existing ? { ...i, qty: i.qty + 1 } : i));
      return [...c, { productId: p.id, name: p.name, price: p.price, qty: 1, discount: 0 }];
    });
  }, []);
  const changeQty = (item: CartItem, delta: number) =>
    setCart((c) => c.flatMap((i) => (i !== item ? [i] : i.qty + delta > 0 ? [{ ...i, qty: i.qty + delta }] : [])));

  // Фоновая синхронизация
  useEffect(() => {
    const tick = async () => {
      setPending(await sync());
      setOnline(navigator.onLine);
    };
    tick();
    const t = setInterval(tick, 15000);
    return () => clearInterval(t);
  }, []);

  // Сканер штрихкодов работает как клавиатура: цифры и Enter в конце
  useEffect(() => {
    let buffer = '';
    let last = 0;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      const now = Date.now();
      if (now - last > 100) buffer = '';
      last = now;
      if (e.key === 'Enter' && buffer.length >= 6) {
        const p = catalog.products.find((x) => x.barcode === buffer);
        if (p) add(p);
        else setToast(`Товар со штрихкодом ${buffer} не найден`);
        buffer = '';
      } else if (/^\d$/.test(e.key)) buffer += e.key;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [catalog, add]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  async function pay(payment: 'cash' | 'card', change = 0) {
    const receipt: Receipt = {
      id: uuid(),
      cashierId: session.user.id,
      shiftId: shift.id,
      kind: mode,
      payment,
      cardAmount: payment === 'card' ? total : 0,
      createdAt: new Date().toISOString(),
      items: cart,
    };
    try {
      await fiscal.printReceipt(receipt, session.user.name);
    } catch (e) {
      setToast(`Ошибка ККТ: ${(e as Error).message}`);
      return;
    }
    enqueue({ receipt });
    storage.setShiftReceipts([...storage.shiftReceipts(), receipt]);
    setCart([]);
    setModal(null);
    setMode('sale');
    setToast(`${mode === 'return' ? 'Возврат' : 'Продажа'} ${rub(total)}${change > 0 ? ` · сдача ${rub(change)}` : ''}`);
    setPending(await sync());
  }

  return (
    <div className={`register ${mode}`}>
      <header>
        <div>
          <b>{props.addressName}</b> · {session.user.name}
        </div>
        <div className="header-actions">
          <span className={`status ${online && !pending ? 'ok' : 'warn'}`}>
            {pending ? `Не отправлено: ${pending}` : online ? 'Онлайн' : 'Нет сети'}
          </span>
          <button className={mode === 'return' ? 'on' : ''} onClick={() => setMode(mode === 'sale' ? 'return' : 'sale')}>Возврат</button>
          <button onClick={() => setModal('writeoff')}>Списание</button>
          <button onClick={() => setModal('close')}>Закрыть смену</button>
          <button onClick={props.onLock}>🔒</button>
        </div>
      </header>

      <section className="catalog">
        <div className="cats">
          <button className={category === 'all' ? 'active' : ''} onClick={() => setCategory('all')}>Все</button>
          {catalog.categories.map((c) => (
            <button key={c.id} className={category === c.id ? 'active' : ''} style={{ ['--c' as string]: c.color }} onClick={() => setCategory(c.id)}>
              {c.name}
            </button>
          ))}
          <input className="search" placeholder="Поиск" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="grid">
          {products.map((p) => (
            <button key={p.id} className="tile" style={{ ['--c' as string]: colorOf(p) }} onClick={() => add(p)}>
              <span className="tile-name">{p.name}</span>
              <span className="tile-price">{rub(p.price)}</span>
            </button>
          ))}
          {!products.length && <div className="muted">Нет товаров. Каталог загрузится после входа при наличии сети.</div>}
        </div>
      </section>

      <aside className="cart">
        <h2>{mode === 'return' ? 'Возврат' : 'Чек'}</h2>
        <div className="lines">
          {cart.map((i) => (
            <div key={i.productId ?? i.name} className="line">
              <div className="line-name">{i.name}<small>{rub(i.price)}</small></div>
              <div className="qty">
                <button onClick={() => changeQty(i, -1)}>−</button>
                <span>{i.qty}</span>
                <button onClick={() => changeQty(i, 1)}>+</button>
              </div>
              <div className="line-sum">{rub(lineTotal(i))}</div>
            </div>
          ))}
          {!cart.length && <div className="muted empty">Нажмите на товар, чтобы добавить его в чек</div>}
        </div>
        <div className="total">
          <span>Итого</span>
          <b>{rub(total)}</b>
        </div>
        <div className="pay">
          <button className="big" disabled={!cart.length} onClick={() => setModal('cash')}>Наличные</button>
          <button className="big primary" disabled={!cart.length} onClick={() => pay('card')}>Карта</button>
        </div>
        {cart.length > 0 && <button className="clear" onClick={() => setCart([])}>Очистить</button>}
      </aside>

      {modal === 'cash' && <CashModal total={total} isReturn={mode === 'return'} onPay={(change) => pay('cash', change)} onClose={() => setModal(null)} />}
      {modal === 'writeoff' && (
        <WriteoffModal products={catalog.products} addressId={props.addressId} onDone={(msg) => { setModal(null); setToast(msg); }} onClose={() => setModal(null)} />
      )}
      {modal === 'close' && (
        <CloseShiftModal
          shift={shift}
          cashier={session.user.name}
          onClose={() => setModal(null)}
          onClosed={() => { setModal(null); props.onShiftClosed(); }}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="modal-bg" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="panel modal">
        <div className="modal-head">
          <h2>{title}</h2>
          <button onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function CashModal({ total, isReturn, onPay, onClose }: { total: number; isReturn: boolean; onPay: (change: number) => void; onClose: () => void }) {
  const [given, setGiven] = useState('');
  const received = given ? Number(given) : total;
  const change = Math.round((received - total) * 100) / 100;
  if (isReturn) {
    return (
      <Modal title="Возврат наличными" onClose={onClose}>
        <div className="amount">{rub(total)}</div>
        <button className="big primary" onClick={() => onPay(0)}>Выдать покупателю</button>
      </Modal>
    );
  }
  return (
    <Modal title="Оплата наличными" onClose={onClose}>
      <div className="cash-row"><span>К оплате</span><b>{rub(total)}</b></div>
      <div className="cash-row"><span>Получено</span><b>{rub(received)}</b></div>
      <div className={`cash-row ${change < 0 ? 'error' : 'change'}`}><span>Сдача</span><b>{change < 0 ? 'не хватает' : rub(change)}</b></div>
      <div className="quick">
        {[100, 200, 500, 1000, 2000, 5000].filter((v) => v >= total).slice(0, 4).map((v) => (
          <button key={v} onClick={() => setGiven(String(v))}>{v}</button>
        ))}
        <button onClick={() => setGiven('')}>Без сдачи</button>
      </div>
      <Keypad value={given} onChange={setGiven} max={6} />
      <button className="big primary" disabled={change < 0} onClick={() => onPay(change)}>Провести</button>
    </Modal>
  );
}

function WriteoffModal({ products, addressId, onDone, onClose }: {
  products: Product[]; addressId: number; onDone: (msg: string) => void; onClose: () => void;
}) {
  const [qty, setQty] = useState<Record<number, number>>({});
  const [error, setError] = useState('');
  const [id] = useState(uuid());
  const items = Object.entries(qty).filter(([, q]) => q > 0).map(([productId, q]) => ({ productId: Number(productId), qty: q }));

  async function submit() {
    setError('');
    try {
      await api('/api/stock', { method: 'POST', body: { id, kind: 'writeoff', addressId, items, note: 'С кассы' } });
      onDone('Списание проведено');
    } catch (e) {
      setError(`Не удалось отправить: ${(e as Error).message}`);
    }
  }

  return (
    <Modal title="Списание (потери)" onClose={onClose}>
      <div className="writeoff">
        {products.map((p) => (
          <div key={p.id} className="wo-row">
            <span>{p.name}</span>
            <div className="qty">
              <button onClick={() => setQty({ ...qty, [p.id]: Math.max(0, (qty[p.id] ?? 0) - 1) })}>−</button>
              <span>{qty[p.id] ?? 0}</span>
              <button onClick={() => setQty({ ...qty, [p.id]: (qty[p.id] ?? 0) + 1 })}>+</button>
            </div>
          </div>
        ))}
      </div>
      {error && <div className="error">{error}</div>}
      <button className="big primary" disabled={!items.length} onClick={submit}>Списать</button>
    </Modal>
  );
}

function CloseShiftModal({ shift, cashier, onClose, onClosed }: { shift: Shift; cashier: string; onClose: () => void; onClosed: () => void }) {
  const receipts = storage.shiftReceipts();
  const sum = (kind: Receipt['kind'], payment?: Receipt['payment']) =>
    receipts.filter((r) => r.kind === kind && (!payment || r.payment === payment)).reduce((s, r) => s + cartTotal(r.items), 0);
  const sales = receipts.filter((r) => r.kind === 'sale');
  const expectedCash = shift.openingCash + sum('sale', 'cash') - sum('return', 'cash');
  const [cash, setCash] = useState('');

  async function close() {
    await fiscal.closeShift(cashier);
    const closed: Shift = { ...shift, closedAt: new Date().toISOString(), closingCash: cash === '' ? expectedCash : Number(cash) };
    enqueue({ shift: closed });
    storage.setShift(null);
    storage.setShiftReceipts([]);
    sync();
    onClosed();
  }

  return (
    <Modal title="Закрытие смены" onClose={onClose}>
      <div className="cash-row"><span>Чеков продажи</span><b>{sales.length}</b></div>
      <div className="cash-row"><span>Выручка</span><b>{rub(sum('sale') - sum('return'))}</b></div>
      <div className="cash-row"><span>— наличными</span><b>{rub(sum('sale', 'cash'))}</b></div>
      <div className="cash-row"><span>— картой</span><b>{rub(sum('sale', 'card'))}</b></div>
      <div className="cash-row"><span>Возвраты</span><b>{rub(sum('return'))}</b></div>
      <div className="cash-row change"><span>Должно быть в кассе</span><b>{rub(expectedCash)}</b></div>
      <p>Фактически в кассе: <b>{cash === '' ? '—' : rub(Number(cash))}</b></p>
      <Keypad value={cash} onChange={setCash} max={7} />
      <button className="big primary" onClick={close}>Закрыть смену</button>
    </Modal>
  );
}
