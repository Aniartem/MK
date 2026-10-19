import { useEffect, useState } from 'react';
import { api, qs } from '../api';
import { DataTable, Field, FilterBar, Modal, MultiPicker, Page, loadAddresses, useFilters, useLoad, useParam, useTab } from '../components';
import { money, qty } from '../format';

export const docLabels: Record<string, string> = {
  sale: 'Продажа', return: 'Возврат', production: 'Выпуск', writeoff: 'Списание', transfer: 'Перемещение',
  supply: 'Поступление (накладная)', inventory: 'Инвентаризация', shift_open: 'Открытие смены', shift_close: 'Закрытие смены',
  deposit: 'Внесение в кассу', withdrawal: 'Изъятие из кассы',
};

const tabs: [string, string, string][] = [
  ['all', 'Все документы', ''],
  ['sales', 'Продажи', 'sale,return'],
  ['production', 'Производство', 'production'],
  ['losses', 'Потери', 'writeoff'],
  ['transfers', 'Перемещения', 'transfer'],
  ['supply', 'Накладные', 'supply'],
  ['inventory', 'Инвентаризации', 'inventory'],
  ['cash', 'Касса', 'shift_open,shift_close,deposit,withdrawal'],
];

type Row = { id: string; type: string; number: string | null; at: string; address: string; user: string; amount: number; note: string | null };

export default function Journal() {
  const [tab, setTab] = useTab('all');
  const [f, set] = useFilters();
  const [users, setUsers] = useParam('users', '');
  const [staff, setStaff] = useState<{ id: number; name: string }[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [details, setDetails] = useState<any>(null);
  const [create, setCreate] = useState<DocKind | null>(null);
  const [menu, setMenu] = useState(false);
  const types = tabs.find((t) => t[0] === tab)![2];
  const [rows, reload] = useLoad<Row[]>(
    () => api(`/api/journal?${qs({ start: f.start, finish: f.finish, addresses: f.addresses, types, users, limit: 1000 })}`),
    [f.start, f.finish, f.addresses, types, users],
  );

  useEffect(() => void api('/api/users').then(setStaff), []);

  async function toggle(r: Row) {
    if (open === r.id) return setOpen(null);
    setOpen(r.id);
    setDetails(null);
    setDetails(await api(`/api/journal/${r.type}/${r.id}`));
  }

  return (
    <Page
      title="Журнал документов"
      tabs={tabs.map(([k, l]) => [k, l])}
      tab={tab}
      onTab={setTab}
      actions={
        <div className="dropdown">
          <button className="btn primary" onClick={() => setMenu(!menu)}>Создать ▾</button>
          {menu && (
            <div className="dropdown-menu" onMouseLeave={() => setMenu(false)}>
              {(['supply', 'production', 'writeoff', 'transfer', 'inventory'] as DocKind[]).map((k) => (
                <button key={k} onClick={() => { setCreate(k); setMenu(false); }}>{docLabels[k]}</button>
              ))}
            </div>
          )}
        </div>
      }
    >
      <FilterBar f={f} set={set} show={['addresses']}>
        <MultiPicker options={staff} value={users} onChange={setUsers} placeholder="Все пользователи" />
      </FilterBar>
      <DataTable<Row>
        rows={rows}
        totals={false}
        exportName={`журнал-${f.start}-${f.finish}`}
        onRow={toggle}
        rowClass={(r) => (r.type === 'withdrawal' || r.type === 'return' ? 'highlight' : undefined)}
        expanded={(r) => (open === r.id ? <Details type={r.type} data={details} /> : null)}
        columns={[
          { key: 'at', label: 'Дата', value: (r) => r.at, render: (v) => <DateCell at={v} /> },
          { key: 'number', label: '№', value: (r) => r.number ?? r.id.slice(0, 8) },
          { key: 'type', label: 'Тип', render: (v, r) => <>{docLabels[v] ?? v}{r.note && <small className="sub">{r.note}</small>}</> },
          { key: 'address', label: 'Адрес' },
          { key: 'user', label: 'Пользователь' },
          { key: 'amount', label: 'Сумма', align: 'right', render: money },
        ]}
      />
      {create && <DocumentModal kind={create} onClose={() => setCreate(null)} onSaved={() => { setCreate(null); reload(); }} />}
    </Page>
  );
}

function DateCell({ at }: { at: string }) {
  const d = new Date(at);
  return (
    <>
      {d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
      <small className="sub">{d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })}</small>
    </>
  );
}

function Details({ type, data }: { type: string; data: any }) {
  if (!data) return <span className="muted">Загрузка…</span>;
  if (type === 'shift_open' || type === 'shift_close') {
    return (
      <div className="detail-grid">
        <span>Чеков продажи</span><b>{data.checks}</b>
        <span>Выручка</span><b>{money(data.revenue)}</b>
        <span>— картой</span><b>{money(data.card)}</b>
        <span>Наличные на начало</span><b>{money(data.openingCash)}</b>
        <span>Ожидалось в кассе</span><b>{money(data.expectedCash)}</b>
        <span>Фактически при закрытии</span><b>{data.closingCash === null ? '—' : money(data.closingCash)}</b>
      </div>
    );
  }
  if (!data.length) return <span className="muted">Без позиций</span>;
  return (
    <>
      {data.map((i: any, n: number) => (
        <div key={n}>
          {i.name} — {qty(i.qty)}
          {i.price !== undefined ? ` × ${money(i.price)}` : ''} = {money(i.amount)}
          {i.discount > 0 && <span className="muted"> (скидка {money(i.discount)})</span>}
          {type === 'supply' && <span className="muted"> · закупка {money(i.cost)}</span>}
        </div>
      ))}
    </>
  );
}

export type DocKind = 'supply' | 'production' | 'writeoff' | 'transfer' | 'inventory';
type Product = { id: number; name: string; price: number; cost: number; unit: string; kind: string; active: boolean };

export function DocumentModal({ kind, onClose, onSaved }: { kind: DocKind; onClose: () => void; onSaved: () => void }) {
  const [addresses, setAddresses] = useState<{ id: number; name: string; isWarehouse: boolean }[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [counterparties, setCounterparties] = useState<{ id: number; name: string }[]>([]);
  const [addressId, setAddressId] = useState<number>(0);
  const [toAddressId, setToAddressId] = useState<number>(0);
  const [counterpartyId, setCounterpartyId] = useState<number>(0);
  const [note, setNote] = useState('');
  const [search, setSearch] = useState('');
  const [lines, setLines] = useState<Record<number, { qty: string; cost?: string }>>({});
  const [error, setError] = useState('');

  useEffect(() => {
    loadAddresses().then((a) => {
      setAddresses(a);
      setAddressId((kind === 'supply' ? a.find((x) => x.isWarehouse) : a.find((x) => !x.isWarehouse))?.id ?? a[0]?.id);
    });
    api('/api/products').then((p: Product[]) =>
      setProducts(p.filter((x) => x.active && (kind === 'production' ? x.kind === 'product' : kind === 'supply' ? x.kind !== 'product' : true))),
    );
    if (kind === 'supply') api('/api/counterparties').then(setCounterparties);
  }, [kind]);

  const items = Object.entries(lines)
    .filter(([, l]) => l.qty !== '' && (kind === 'inventory' || Number(l.qty) > 0))
    .map(([id, l]) => ({ productId: Number(id), qty: Number(l.qty), ...(l.cost ? { cost: Number(l.cost) } : {}) }));
  const total = items.reduce((s, i) => {
    const p = products.find((x) => x.id === i.productId)!;
    return s + i.qty * (kind === 'supply' ? i.cost ?? p.cost : p.price);
  }, 0);

  async function save() {
    setError('');
    try {
      await api('/api/stock', {
        method: 'POST',
        body: {
          kind, addressId, items, note: note || undefined,
          ...(kind === 'transfer' ? { toAddressId } : {}),
          ...(kind === 'supply' && counterpartyId ? { counterpartyId } : {}),
        },
      });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const shown = products.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));
  return (
    <Modal title={docLabels[kind]} onClose={onClose} wide>
      <div className="form">
        <div className="form-row">
          <Field label={kind === 'transfer' ? 'Откуда' : 'Адрес'}>
            <select value={addressId} onChange={(e) => setAddressId(Number(e.target.value))}>
              {addresses.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
          {kind === 'transfer' && (
            <Field label="Куда">
              <select value={toAddressId} onChange={(e) => setToAddressId(Number(e.target.value))}>
                <option value={0}>—</option>
                {addresses.filter((a) => a.id !== addressId).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
          )}
          {kind === 'supply' && (
            <Field label="Поставщик">
              <select value={counterpartyId} onChange={(e) => setCounterpartyId(Number(e.target.value))}>
                <option value={0}>—</option>
                {counterparties.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
          )}
        </div>
        {kind === 'inventory' && <p className="hint">Введите фактический остаток по каждому пересчитанному товару. Разница с учётом сохранится как расхождение.</p>}
        <input className="input" placeholder="Поиск товара" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="qty-list">
          <div className="qty-head">
            <span>Товар</span>
            <span>{kind === 'inventory' ? 'Факт' : 'Кол-во'}</span>
            {kind === 'supply' && <span>Цена закупки</span>}
          </div>
          {shown.map((p) => (
            <label key={p.id}>
              <span>{p.name} <small className="muted">{p.unit}</small></span>
              <input type="number" min="0" step="any" placeholder="0" value={lines[p.id]?.qty ?? ''}
                onChange={(e) => setLines({ ...lines, [p.id]: { ...lines[p.id], qty: e.target.value } })} />
              {kind === 'supply' && (
                <input type="number" min="0" step="0.01" placeholder={String(p.cost)} value={lines[p.id]?.cost ?? ''}
                  onChange={(e) => setLines({ ...lines, [p.id]: { qty: lines[p.id]?.qty ?? '', cost: e.target.value } })} />
              )}
            </label>
          ))}
        </div>
        <Field label="Комментарий"><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        {error && <div className="error">{error}</div>}
        <button className="btn primary" disabled={!items.length || (kind === 'transfer' && !toAddressId)} onClick={save}>
          Провести{kind !== 'inventory' && ` на ${money(total)} ₽`}
        </button>
      </div>
    </Modal>
  );
}
