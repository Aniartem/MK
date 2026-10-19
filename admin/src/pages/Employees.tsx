import { useEffect, useState } from 'react';
import { api } from '../api';
import { Field, Modal, Page } from '../components';

type User = { id?: number; name: string; role: 'owner' | 'manager' | 'cashier'; email: string | null; active: boolean; hasPin?: boolean; pin?: string; password?: string };
const roleLabel = { owner: 'Владелец', manager: 'Управляющий', cashier: 'Кассир' };

export default function Employees() {
  const [users, setUsers] = useState<User[]>([]);
  const [edit, setEdit] = useState<User | null>(null);
  const [error, setError] = useState('');
  const load = () => api('/api/users').then(setUsers);
  useEffect(() => void load(), []);

  async function save() {
    if (!edit) return;
    setError('');
    const body = { ...edit, pin: edit.pin || undefined, password: edit.password || undefined, email: edit.email || null };
    try {
      await api(edit.id ? `/api/users/${edit.id}` : '/api/users', { method: edit.id ? 'PUT' : 'POST', body });
      setEdit(null);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Page title="Сотрудники" actions={<button className="btn primary" onClick={() => setEdit({ name: '', role: 'cashier', email: null, active: true })}>+ Сотрудник</button>}>
      <div className="card table-wrap">
        <table className="table">
          <thead><tr><th>Имя</th><th>Роль</th><th>Email</th><th>PIN на кассе</th><th>Статус</th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="clickable" onClick={() => setEdit(u)}>
                <td className="name">{u.name}</td>
                <td>{roleLabel[u.role]}</td>
                <td>{u.email ?? ''}</td>
                <td>{u.hasPin ? 'задан' : '—'}</td>
                <td>{u.active ? 'Работает' : <span className="muted">Отключён</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && (
        <Modal title={edit.id ? edit.name : 'Новый сотрудник'} onClose={() => setEdit(null)}>
          <div className="form">
            <Field label="Имя"><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus /></Field>
            <Field label="Роль">
              <select value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value as User['role'] })}>
                {Object.entries(roleLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label={edit.hasPin ? 'Новый PIN для кассы (оставьте пустым, чтобы не менять)' : 'PIN для кассы (4 цифры)'}>
              <input inputMode="numeric" maxLength={4} value={edit.pin ?? ''} onChange={(e) => setEdit({ ...edit, pin: e.target.value.replace(/\D/g, '') })} />
            </Field>
            {edit.role !== 'cashier' && (
              <>
                <Field label="Email для входа в кабинет"><input value={edit.email ?? ''} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
                <Field label={edit.id ? 'Новый пароль (необязательно)' : 'Пароль'}>
                  <input type="password" value={edit.password ?? ''} onChange={(e) => setEdit({ ...edit, password: e.target.value })} />
                </Field>
              </>
            )}
            <label className="check"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Работает</label>
            {error && <div className="error">{error}</div>}
            <button className="btn primary" onClick={save}>Сохранить</button>
          </div>
        </Modal>
      )}
    </Page>
  );
}
