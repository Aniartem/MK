import { Fragment, useEffect, useState } from 'react';
import { api, qs } from '../api';
import { Field, Modal, Page } from '../components';
import { dateTime, isoDay, money, qty } from '../format';

const kindLabel: Record<string, string> = { production: 'Выпуск', writeoff: 'Списание', transfer: 'Перемещение' };
type Doc = { kind: 'production' | 'writeoff' | 'transfer'; addressId: number; toAddressId?: number; note: string; items: { productId: number; qty: number }[] };

export default function Stock() {
  const [start, setStart] = useState(isoDay(new Date()));
  const [finish, setFinish] = useState(isoDay(new Date()));
  const [rows, setRows] = useState<any[]>([]);
  const [addresses, setAddresses] = useState<{ id: number; name: string }[]>([]);
  const [products, setProducts] = useState<{ id: number; name: string; price: number; active: boolean }[]>([]);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = () => api(`/api/stock?${qs({ start, finish })}`).then(setRows);
  useEffect(() => void load(), [start, finish]);
  useEffect(() => {
    api('/api/addresses').then(setAddresses);
    api('/api/products').then((p) => setProducts(p.filter((x: any) => x.active)));
  }, []);

  const newDoc = (kind: Doc['kind']) => setDoc({ kind, addressId: addresses[0]?.id, note: '', items: [] });
  const setQty = (productId: number, value: number) => {
    if (!doc) return;
    const items = doc.items.filter((i) => i.productId !== productId);
    if (value > 0) items.push({ productId, qty: value });
    setDoc({ ...doc, items });
  };
  async function save() {
    if (!doc) return;
    setError('');
    try {
      await api('/api/stock', { method: 'POST', body: doc });
      setDoc(null);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const docTotal = doc?.items.reduce((s, i) => s + i.qty * (products.find((p) => p.id === i.productId)?.price ?? 0), 0) ?? 0;

  return (
    <Page
      title="Выпуск, списание, перемещение"
      actions={
        <>
          <div className="daterange">
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            <span>—</span>
            <input type="date" value={finish} onChange={(e) => setFinish(e.target.value)} />
          </div>
          <button className="btn" onClick={() => newDoc('transfer')}>Перемещение</button>
          <button className="btn" onClick={() => newDoc('writeoff')}>Списание</button>
          <button className="btn primary" onClick={() => newDoc('production')}>+ Выпуск</button>
        </>
      }
    >
      <div className="card table-wrap">
        <table className="table">
          <thead><tr><th>Дата</th><th>Документ</th><th>Адрес</th><th>Сотрудник</th><th>Комментарий</th><th>Сумма</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <Fragment key={r.id}>
                <tr className="clickable" onClick={() => setOpen(open === r.id ? null : r.id)}>
                  <td>{dateTime(r.createdAt)}</td>
                  <td className={r.kind === 'writeoff' ? 'bad' : ''}>{kindLabel[r.kind]}</td>
                  <td>{r.address}</td>
                  <td>{r.user ?? '—'}</td>
                  <td>{r.note ?? ''}</td>
                  <td>{money(r.amount)}</td>
                </tr>
                {open === r.id && (
                  <tr className="details">
                    <td colSpan={6}>
                      {r.items.map((i: any, n: number) => <div key={n}>{i.name} — {qty(i.qty)} шт, {money(i.amount)}</div>)}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {!rows.length && <tr><td colSpan={6} className="empty">Нет документов за период</td></tr>}
          </tbody>
        </table>
      </div>

      {doc && (
        <Modal title={kindLabel[doc.kind]} onClose={() => setDoc(null)}>
          <div className="form">
            <Field label={doc.kind === 'transfer' ? 'Откуда' : 'Адрес'}>
              <select value={doc.addressId} onChange={(e) => setDoc({ ...doc, addressId: Number(e.target.value) })}>
                {addresses.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
            {doc.kind === 'transfer' && (
              <Field label="Куда">
                <select value={doc.toAddressId ?? ''} onChange={(e) => setDoc({ ...doc, toAddressId: Number(e.target.value) })}>
                  <option value="">—</option>
                  {addresses.filter((a) => a.id !== doc.addressId).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </Field>
            )}
            <div className="qty-list">
              {products.map((p) => (
                <label key={p.id}>
                  <span>{p.name}</span>
                  <input
                    type="number" min="0" placeholder="0"
                    value={doc.items.find((i) => i.productId === p.id)?.qty ?? ''}
                    onChange={(e) => setQty(p.id, Number(e.target.value))}
                  />
                </label>
              ))}
            </div>
            <Field label="Комментарий"><input value={doc.note} onChange={(e) => setDoc({ ...doc, note: e.target.value })} /></Field>
            {error && <div className="error">{error}</div>}
            <button className="btn primary" disabled={!doc.items.length} onClick={save}>Провести на {money(docTotal)} ₽</button>
          </div>
        </Modal>
      )}
    </Page>
  );
}
