import { useEffect, useState } from 'react';
import { api } from '../api';
import { Field, Modal, Page, kindLabels, resetCaches } from '../components';
import { money } from '../format';

type Product = { id?: number; name: string; categoryId: number | null; price: number; cost: number; unit: string; kind: string; barcode: string | null; active: boolean; sort: number };
type Category = { id?: number; name: string; color: string; sort: number };

const emptyProduct: Product = { name: '', categoryId: null, price: 0, cost: 0, unit: 'шт', kind: 'product', barcode: null, active: true, sort: 0 };
const markup = (p: Product) => (p.cost ? Math.round(((p.price - p.cost) / p.cost) * 10000) / 100 : null);

export default function Products() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [edit, setEdit] = useState<Product | null>(null);
  const [editCat, setEditCat] = useState<Category | null>(null);
  const [filter, setFilter] = useState<number | 'all'>('all');
  const [kind, setKind] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');

  const load = () => {
    api('/api/products').then(setProducts);
    api('/api/categories').then(setCategories);
  };
  useEffect(load, []);

  async function save(path: string, item: { id?: number }, close: () => void) {
    setError('');
    try {
      await api(item.id ? `${path}/${item.id}` : path, { method: item.id ? 'PUT' : 'POST', body: item });
      close();
      resetCaches();
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const shown = products.filter(
    (p) => (filter === 'all' || p.categoryId === filter) && (!kind || p.kind === kind) && p.name.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <Page
      title="Номенклатура"
      actions={
        <>
          <button className="btn" onClick={() => setEditCat({ name: '', color: '#4a7bd6', sort: categories.length })}>+ Категория</button>
          <button className="btn primary" onClick={() => setEdit({ ...emptyProduct, categoryId: filter === 'all' ? null : filter })}>+ Товар</button>
        </>
      }
    >
      <div className="filters-bar">
        <input className="input" placeholder="Поиск" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">Тип номенклатуры</option>
          {Object.entries(kindLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div className="chips">
        <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Все</button>
        {categories.map((c) => (
          <button key={c.id} className={filter === c.id ? 'active' : ''} onClick={() => setFilter(c.id!)} onDoubleClick={() => setEditCat(c)}>
            <i style={{ background: c.color }} /> {c.name}
          </button>
        ))}
      </div>
      <div className="card table-wrap">
        <table className="table">
          <thead>
            <tr><th>Название</th><th>Категория</th><th>Ед. изм.</th><th className="right">Себестоимость</th><th className="right">Наценка, %</th><th className="right">Цена</th><th>Штрихкод</th><th>Статус</th></tr>
          </thead>
          <tbody>
            {shown.map((p) => (
              <tr key={p.id} className="clickable" onClick={() => setEdit(p)}>
                <td className="name">{p.name}<small className="sub">{kindLabels[p.kind]}</small></td>
                <td className="caps">
                  <i className="dot" style={{ background: categories.find((c) => c.id === p.categoryId)?.color }} />
                  {categories.find((c) => c.id === p.categoryId)?.name ?? '—'}
                </td>
                <td>{p.unit}</td>
                <td className="right">{money(p.cost)}</td>
                <td className={`right ${(markup(p) ?? 0) < 0 ? 'bad' : ''}`}>{markup(p) === null ? '—' : money(markup(p))}</td>
                <td className="right">{p.kind === 'raw' ? '—' : money(p.price)}</td>
                <td>{p.barcode ?? ''}</td>
                <td>{p.active ? 'В продаже' : <span className="muted">Скрыт</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">Двойной клик по категории — редактировать её.</p>

      {edit && (
        <Modal title={edit.id ? 'Товар' : 'Новый товар'} onClose={() => setEdit(null)}>
          <div className="form">
            <Field label="Название"><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus /></Field>
            <Field label="Тип">
              <select value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })}>
                <option value="product">Продукция (своё производство)</option>
                <option value="goods">Товар (перепродажа)</option>
                <option value="raw">Сырьё (не продаётся на кассе)</option>
              </select>
            </Field>
            <Field label="Категория">
              <select value={edit.categoryId ?? ''} onChange={(e) => setEdit({ ...edit, categoryId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">Без категории</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Цена, ₽"><input type="number" step="0.01" value={edit.price} onChange={(e) => setEdit({ ...edit, price: Number(e.target.value) })} /></Field>
            <Field label="Себестоимость, ₽"><input type="number" step="0.01" value={edit.cost} onChange={(e) => setEdit({ ...edit, cost: Number(e.target.value) })} /></Field>
            <Field label="Единица">
              <select value={edit.unit} onChange={(e) => setEdit({ ...edit, unit: e.target.value })}>
                <option>шт</option><option>кг</option><option>л</option><option>мл</option><option>г</option>
              </select>
            </Field>
            <Field label="Штрихкод"><input value={edit.barcode ?? ''} onChange={(e) => setEdit({ ...edit, barcode: e.target.value || null })} /></Field>
            <label className="check"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> В продаже</label>
            {error && <div className="error">{error}</div>}
            <button className="btn primary" onClick={() => save('/api/products', edit, () => setEdit(null))}>Сохранить</button>
          </div>
        </Modal>
      )}
      {editCat && (
        <Modal title={editCat.id ? 'Категория' : 'Новая категория'} onClose={() => setEditCat(null)}>
          <div className="form">
            <Field label="Название"><input value={editCat.name} onChange={(e) => setEditCat({ ...editCat, name: e.target.value })} autoFocus /></Field>
            <Field label="Цвет на кассе"><input type="color" value={editCat.color} onChange={(e) => setEditCat({ ...editCat, color: e.target.value })} /></Field>
            <Field label="Порядок"><input type="number" value={editCat.sort} onChange={(e) => setEditCat({ ...editCat, sort: Number(e.target.value) })} /></Field>
            {error && <div className="error">{error}</div>}
            <button className="btn primary" onClick={() => save('/api/categories', editCat, () => setEditCat(null))}>Сохранить</button>
          </div>
        </Modal>
      )}
    </Page>
  );
}
