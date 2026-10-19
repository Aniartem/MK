import { useEffect, useState } from 'react';
import { api } from '../api';
import { Field, Modal, Page } from '../components';

type Address = { id?: number; name: string; isWarehouse: boolean; active: boolean };

export default function Addresses() {
  const [rows, setRows] = useState<Address[]>([]);
  const [edit, setEdit] = useState<Address | null>(null);
  const load = () => api('/api/addresses').then(setRows);
  useEffect(() => void load(), []);

  async function save() {
    if (!edit) return;
    await api(edit.id ? `/api/addresses/${edit.id}` : '/api/addresses', { method: edit.id ? 'PUT' : 'POST', body: edit });
    setEdit(null);
    load();
  }

  return (
    <Page title="Точки продаж и склады" actions={<button className="btn primary" onClick={() => setEdit({ name: '', isWarehouse: false, active: true })}>+ Адрес</button>}>
      <div className="card table-wrap">
        <table className="table">
          <thead><tr><th>Название</th><th>Тип</th><th>Статус</th></tr></thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} className="clickable" onClick={() => setEdit(a)}>
                <td className="name">{a.name}</td>
                <td>{a.isWarehouse ? 'Склад' : 'Точка продаж'}</td>
                <td>{a.active ? 'Работает' : <span className="muted">Закрыта</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && (
        <Modal title={edit.id ? edit.name : 'Новый адрес'} onClose={() => setEdit(null)}>
          <div className="form">
            <Field label="Название"><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus /></Field>
            <label className="check"><input type="checkbox" checked={edit.isWarehouse} onChange={(e) => setEdit({ ...edit, isWarehouse: e.target.checked })} /> Это склад (без кассы)</label>
            <label className="check"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Работает</label>
            <button className="btn primary" onClick={save}>Сохранить</button>
          </div>
        </Modal>
      )}
    </Page>
  );
}
