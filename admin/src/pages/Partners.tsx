import { useEffect, useState } from 'react';
import { api } from '../api';
import { DataTable, Field, Modal, Page, loadAddresses, loadCategories, useLoad } from '../components';

type Counterparty = { id?: number; name: string; inn: string | null; address: string | null; paymentDelay: number | null; note: string | null };

export function Counterparties() {
  const [rows, reload] = useLoad<Counterparty[]>(() => api('/api/counterparties'), []);
  const [search, setSearch] = useState('');
  const [edit, setEdit] = useState<Counterparty | null>(null);
  const [error, setError] = useState('');

  async function save() {
    if (!edit) return;
    setError('');
    try {
      await api(edit.id ? `/api/counterparties/${edit.id}` : '/api/counterparties', { method: edit.id ? 'PUT' : 'POST', body: edit });
      setEdit(null);
      reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const q = search.toLowerCase();
  return (
    <Page
      title="Контрагенты"
      actions={<button className="btn primary" onClick={() => setEdit({ name: '', inn: null, address: null, paymentDelay: null, note: null })}>Создать</button>}
    >
      <div className="filters-bar"><input className="input" placeholder="Поиск" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      <DataTable<Counterparty>
        rows={rows?.filter((r) => !q || r.name.toLowerCase().includes(q) || r.inn?.includes(q)) ?? null}
        onRow={setEdit}
        empty="Поставщиков пока нет"
        columns={[
          { key: 'name', label: 'Название' },
          { key: 'inn', label: 'ИНН' },
          { key: 'address', label: 'Адрес' },
          { key: 'paymentDelay', label: 'Дней отсрочки платежа', align: 'right', render: (v) => v ?? '—' },
        ]}
      />
      {edit && (
        <Modal title={edit.id ? edit.name : 'Новый контрагент'} onClose={() => setEdit(null)}>
          <div className="form">
            <Field label="Название"><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus /></Field>
            <Field label="ИНН"><input inputMode="numeric" value={edit.inn ?? ''} onChange={(e) => setEdit({ ...edit, inn: e.target.value.replace(/\D/g, '') || null })} /></Field>
            <Field label="Адрес"><input value={edit.address ?? ''} onChange={(e) => setEdit({ ...edit, address: e.target.value || null })} /></Field>
            <Field label="Отсрочка платежа, дней">
              <input type="number" min="0" value={edit.paymentDelay ?? ''} onChange={(e) => setEdit({ ...edit, paymentDelay: e.target.value === '' ? null : Number(e.target.value) })} />
            </Field>
            <Field label="Комментарий"><input value={edit.note ?? ''} onChange={(e) => setEdit({ ...edit, note: e.target.value || null })} /></Field>
            {error && <div className="error">{error}</div>}
            <button className="btn primary" disabled={!edit.name} onClick={save}>Сохранить</button>
          </div>
        </Modal>
      )}
    </Page>
  );
}

type Promotion = {
  id?: number; name: string; percent: number; mode: 'auto' | 'manual'; categoryIds: number[]; addressIds: number[];
  timeFrom: string | null; timeTo: string | null; description: string | null; active: boolean;
};

export function Promotions() {
  const [rows, reload] = useLoad<Promotion[]>(() => api('/api/promotions'), []);
  const [archive, setArchive] = useState(false);
  const [edit, setEdit] = useState<Promotion | null>(null);
  const [categories, setCategories] = useState<{ id: number; name: string }[]>([]);
  const [addresses, setAddresses] = useState<{ id: number; name: string; isWarehouse: boolean }[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    loadCategories().then(setCategories);
    loadAddresses().then((a) => setAddresses(a.filter((x) => !x.isWarehouse)));
  }, []);

  async function save() {
    if (!edit) return;
    setError('');
    try {
      await api(edit.id ? `/api/promotions/${edit.id}` : '/api/promotions', { method: edit.id ? 'PUT' : 'POST', body: edit });
      setEdit(null);
      reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const toggle = (list: number[], id: number) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const names = (ids: number[], all: { id: number; name: string }[], none: string) =>
    ids.length ? all.filter((x) => ids.includes(x.id)).map((x) => x.name).join(', ') : none;

  return (
    <Page
      title="Акции"
      tabs={[['active', 'Активные'], ['archive', 'Архив']]}
      tab={archive ? 'archive' : 'active'}
      onTab={(t) => setArchive(t === 'archive')}
      actions={
        <button className="btn primary" onClick={() => setEdit({ name: '', percent: 10, mode: 'manual', categoryIds: [], addressIds: [], timeFrom: null, timeTo: null, description: null, active: true })}>
          Создать
        </button>
      }
    >
      <DataTable<Promotion>
        rows={rows?.filter((r) => r.active !== archive) ?? null}
        onRow={setEdit}
        empty={archive ? 'Архив пуст' : 'Акций пока нет'}
        columns={[
          { key: 'name', label: 'Название' },
          { key: 'percent', label: 'Скидка', align: 'right', render: (v) => `${v}%` },
          { key: 'mode', label: 'Применение', render: (v, r) => (v === 'auto' ? `Автоматически${r.timeFrom ? ` с ${r.timeFrom} до ${r.timeTo}` : ''}` : 'Кассир выбирает вручную') },
          { key: 'categoryIds', label: 'Категории', render: (v) => names(v, categories, 'Все товары') },
          { key: 'addressIds', label: 'Точки', render: (v) => names(v, addresses, 'Все точки') },
          { key: 'description', label: 'Описание', render: (v) => v ?? '' },
        ]}
      />
      {edit && (
        <Modal title={edit.id ? edit.name : 'Новая акция'} onClose={() => setEdit(null)}>
          <div className="form">
            <Field label="Название"><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus /></Field>
            <Field label="Скидка, %"><input type="number" min="1" max="100" value={edit.percent} onChange={(e) => setEdit({ ...edit, percent: Number(e.target.value) })} /></Field>
            <div className="segmented">
              <button className={edit.mode === 'manual' ? 'active' : ''} onClick={() => setEdit({ ...edit, mode: 'manual' })}>Ручная (выбирает кассир)</button>
              <button className={edit.mode === 'auto' ? 'active' : ''} onClick={() => setEdit({ ...edit, mode: 'auto' })}>Автоматическая</button>
            </div>
            {edit.mode === 'auto' && (
              <div className="form-row">
                <Field label="С (время)"><input type="time" value={edit.timeFrom ?? ''} onChange={(e) => setEdit({ ...edit, timeFrom: e.target.value || null })} /></Field>
                <Field label="До"><input type="time" value={edit.timeTo ?? ''} onChange={(e) => setEdit({ ...edit, timeTo: e.target.value || null })} /></Field>
              </div>
            )}
            <Field label="Категории (ничего не выбрано — все товары)">
              <div className="checks">
                {categories.map((c) => (
                  <label key={c.id}><input type="checkbox" checked={edit.categoryIds.includes(c.id)} onChange={() => setEdit({ ...edit, categoryIds: toggle(edit.categoryIds, c.id) })} /> {c.name}</label>
                ))}
              </div>
            </Field>
            <Field label="Точки (ничего не выбрано — все)">
              <div className="checks">
                {addresses.map((a) => (
                  <label key={a.id}><input type="checkbox" checked={edit.addressIds.includes(a.id)} onChange={() => setEdit({ ...edit, addressIds: toggle(edit.addressIds, a.id) })} /> {a.name}</label>
                ))}
              </div>
            </Field>
            <Field label="Описание"><input value={edit.description ?? ''} onChange={(e) => setEdit({ ...edit, description: e.target.value || null })} /></Field>
            <label className="check"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Действует</label>
            {error && <div className="error">{error}</div>}
            <button className="btn primary" disabled={!edit.name} onClick={save}>Сохранить</button>
          </div>
        </Modal>
      )}
    </Page>
  );
}
