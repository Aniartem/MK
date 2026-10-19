import { useEffect, useState } from 'react';
import { api } from '../api';
import { DataTable, Field, Modal, Page, loadAddresses, useLoad } from '../components';
import { dateTime } from '../format';
import { EmployeesReport } from './Reports';

type User = {
  id?: number; name: string; role: 'owner' | 'manager' | 'cashier'; email: string | null; active: boolean; hasPin?: boolean;
  pin?: string; password?: string; tabNumber: string | null; addressIds: number[]; lastSeenAt?: string | null;
};
const roleLabel = { owner: 'Владелец', manager: 'Администратор', cashier: 'Кассир' };

// Раздел «Сотрудники»: сводка продаж и кассы по людям
export default function Employees() {
  return (
    <Page title="Сотрудники">
      <EmployeesReport />
    </Page>
  );
}

// Раздел «Пользователи»: учётные записи, PIN, доступ к точкам
export function Users() {
  const [users, reload] = useLoad<User[]>(() => api('/api/users'), []);
  const [addresses, setAddresses] = useState<{ id: number; name: string; isWarehouse: boolean }[]>([]);
  const [search, setSearch] = useState('');
  const [edit, setEdit] = useState<User | null>(null);
  const [error, setError] = useState('');
  useEffect(() => void loadAddresses().then((a) => setAddresses(a.filter((x) => !x.isWarehouse))), []);

  async function save() {
    if (!edit) return;
    setError('');
    const body = { ...edit, pin: edit.pin || undefined, password: edit.password || undefined, email: edit.email || null };
    try {
      await api(edit.id ? `/api/users/${edit.id}` : '/api/users', { method: edit.id ? 'PUT' : 'POST', body });
      setEdit(null);
      reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const toggle = (id: number) =>
    edit && setEdit({ ...edit, addressIds: edit.addressIds.includes(id) ? edit.addressIds.filter((x) => x !== id) : [...edit.addressIds, id] });
  const q = search.toLowerCase();

  return (
    <Page
      title="Пользователи"
      actions={<button className="btn primary" onClick={() => setEdit({ name: '', role: 'cashier', email: null, active: true, tabNumber: null, addressIds: [] })}>Создать</button>}
    >
      <div className="filters-bar"><input className="input grow" placeholder="Поиск" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      <DataTable<User>
        rows={users?.filter((u) => !q || `${u.name} ${u.email ?? ''} ${u.tabNumber ?? ''}`.toLowerCase().includes(q)) ?? null}
        onRow={(u) => setEdit({ ...u })}
        exportName="пользователи"
        rowClass={(u) => (u.active ? undefined : 'inactive')}
        columns={[
          { key: 'name', label: 'Имя' },
          { key: 'tabNumber', label: 'Табельный номер', render: (v) => v ?? '—' },
          { key: 'role', label: 'Должность', value: (u) => roleLabel[u.role] },
          { key: 'hasPin', label: 'PIN', value: (u) => (u.hasPin ? 'задан' : '—') },
          { key: 'email', label: 'Email', render: (v) => v ?? '—' },
          {
            key: 'addressIds', label: 'Адреса',
            value: (u) => (u.addressIds.length ? addresses.filter((a) => u.addressIds.includes(a.id)).map((a) => a.name).join(', ') : 'Все'),
          },
          { key: 'lastSeenAt', label: 'Последний вход', render: (v) => (v ? dateTime(v) : '—') },
        ]}
      />
      {edit && (
        <Modal title={edit.id ? edit.name : 'Новый пользователь'} onClose={() => setEdit(null)}>
          <div className="form">
            <Field label="Имя"><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus /></Field>
            <div className="form-row">
              <Field label="Должность">
                <select value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value as User['role'] })}>
                  {Object.entries(roleLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>
              <Field label="Табельный номер"><input value={edit.tabNumber ?? ''} onChange={(e) => setEdit({ ...edit, tabNumber: e.target.value || null })} /></Field>
            </div>
            <Field label={edit.hasPin ? 'Новый PIN для кассы (пусто — не менять)' : 'PIN для кассы (4 цифры)'}>
              <input inputMode="numeric" maxLength={4} value={edit.pin ?? ''} onChange={(e) => setEdit({ ...edit, pin: e.target.value.replace(/\D/g, '') })} />
            </Field>
            <Field label="Может работать на точках (ничего не выбрано — на всех)">
              <div className="checks">
                {addresses.map((a) => (
                  <label key={a.id}><input type="checkbox" checked={edit.addressIds.includes(a.id)} onChange={() => toggle(a.id)} /> {a.name}</label>
                ))}
              </div>
            </Field>
            {edit.role !== 'cashier' && (
              <>
                <Field label="Email для входа в кабинет"><input value={edit.email ?? ''} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
                <Field label={edit.id ? 'Новый пароль (необязательно)' : 'Пароль (от 6 символов)'}>
                  <input type="password" value={edit.password ?? ''} onChange={(e) => setEdit({ ...edit, password: e.target.value })} />
                </Field>
              </>
            )}
            <label className="check"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Работает</label>
            {error && <div className="error">{error}</div>}
            <button className="btn primary" disabled={!edit.name} onClick={save}>Сохранить</button>
          </div>
        </Modal>
      )}
    </Page>
  );
}
